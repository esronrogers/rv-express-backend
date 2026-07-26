require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago"); // SDK v2
const { calcularTotalSeguro, PRODUTOS } = require("./produtos");

const app = express();
app.use(cors()); // em produção, troque por: cors({ origin: "https://SEU-APP.com" })
app.use(express.json());

// ================================================================
// VALIDAÇÃO DO AMBIENTE — falha rápido e com mensagem clara
// se esquecer de configurar o token, em vez de quebrar em silêncio
// na primeira compra.
// ================================================================
if (!process.env.MP_ACCESS_TOKEN) {
    console.error("❌ ERRO FATAL: variável de ambiente MP_ACCESS_TOKEN não definida.");
    console.error("   Configure-a nas variáveis de ambiente do seu serviço (Render, etc).");
    process.exit(1);
}

// ================================================================
// CONFIGURAÇÃO DO MERCADO PAGO (SDK v2)
// ================================================================
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(client);

// ================================================================
// ENDPOINT PARA CRIAR PAGAMENTO COM CARTÃO
// ================================================================
app.post("/criar-pagamento", async (req, res) => {
    try {
        const { token, payment_method_id, email, cpf, nome, itens } = req.body;

        console.log("📱 Recebendo pagamento com cartão...");

        if (!token) {
            return res.status(400).json({ erro: "Token do cartão não informado" });
        }

        // TOTAL SEMPRE CALCULADO NO SERVIDOR — nunca confia no valor
        // que vem do app, para ninguém conseguir pagar menos manipulando
        // o aplicativo.
        const calculo = calcularTotalSeguro(itens);
        if (!calculo.ok) {
            return res.status(400).json({ erro: calculo.erro });
        }
        const valor = calculo.total;
        console.log("💰 Total validado no servidor:", valor);

        if (!cpf || !/^\d{11}$/.test(String(cpf).replace(/\D/g, ""))) {
            return res.status(400).json({ erro: "CPF inválido ou não informado" });
        }

        const idempotencyKey = crypto.randomUUID();

        const pagamento = await paymentClient.create({
            body: {
                transaction_amount: valor,
                token: token,
                description: "Compra RV Express",
                installments: 1,
                payment_method_id: payment_method_id || "visa",
                payer: {
                    email: email || "cliente@rvexpress.com",
                    identification: {
                        type: "CPF",
                        number: String(cpf).replace(/\D/g, ""),
                    },
                    first_name: nome || "Cliente",
                },
            },
            requestOptions: {
                idempotencyKey,
            },
        });

        console.log("✅ Pagamento criado! Status:", pagamento.status);
        res.json(pagamento);
    } catch (erro) {
        console.error("❌ Erro ao criar pagamento:", erro?.message || erro);
        console.error(erro); // log completo — essencial pra depurar no Render
        res.status(500).json({
            erro: "Erro ao processar pagamento",
            detalhes: erro?.message || String(erro),
        });
    }
});

// ================================================================
// ENDPOINT PARA CRIAR PIX
// ================================================================
app.post("/criar-pix", async (req, res) => {
    try {
        const { email, cpf, nome, itens } = req.body;

        console.log("📱 Criando PIX...");

        const calculo = calcularTotalSeguro(itens);
        if (!calculo.ok) {
            return res.status(400).json({ erro: calculo.erro });
        }
        const valor = calculo.total;
        console.log("💰 Total validado no servidor:", valor);

        if (!cpf || !/^\d{11}$/.test(String(cpf).replace(/\D/g, ""))) {
            return res.status(400).json({ erro: "CPF inválido ou não informado" });
        }

        const idempotencyKey = crypto.randomUUID();

        const pix = await paymentClient.create({
            body: {
                transaction_amount: valor,
                description: "Compra RV Express - PIX",
                payment_method_id: "pix",
                payer: {
                    email: email || "cliente@rvexpress.com",
                    first_name: nome || "Cliente",
                    identification: {
                        type: "CPF",
                        number: String(cpf).replace(/\D/g, ""),
                    },
                },
            },
            requestOptions: {
                idempotencyKey,
            },
        });

        console.log("✅ PIX criado! Status:", pix.status);
        const qrCode = pix.point_of_interaction?.transaction_data?.qr_code || "";
        const qrCodeBase64 = pix.point_of_interaction?.transaction_data?.qr_code_base64 || "";

        res.json({
            status: pix.status,
            id: pix.id,
            qr_code: qrCode,
            qr_code_base64: qrCodeBase64,
            valor: valor,
        });
    } catch (erro) {
        console.error("❌ Erro ao criar PIX:", erro?.message || erro);
        console.error(erro);
        res.status(500).json({
            erro: "Erro ao criar PIX",
            detalhes: erro?.message || String(erro),
        });
    }
});

// ================================================================
// WEBHOOK — recebe notificações do Mercado Pago sobre mudança de
// status (essencial pro Pix, que é assíncrono: o pagamento pode
// ser aprovado segundos ou minutos depois do QR Code ser gerado)
// ================================================================
app.post("/webhook", async (req, res) => {
    try {
        console.log("🔔 Webhook recebido:", JSON.stringify(req.body));
        const { type, data } = req.body;

        if (type === "payment" && data?.id) {
            const pagamento = await paymentClient.get({ id: data.id });
            console.log(`   Pagamento ${data.id} -> status: ${pagamento.status}`);
            // Aqui você pode, por exemplo, marcar a venda como paga
            // no seu banco de dados / planilha quando status === 'approved'.
        }

        res.sendStatus(200); // sempre responder 200 rápido, senão o MP re-envia
    } catch (erro) {
        console.error("❌ Erro no webhook:", erro?.message || erro);
        res.sendStatus(200); // mesmo com erro interno, confirma o recebimento
    }
});

// ================================================================
// ENDPOINT PARA LISTAR PRODUTOS (o app pode usar isso pra conferir
// preços em vez de manter uma cópia só local)
// ================================================================
app.get("/produtos", (req, res) => {
    res.json(PRODUTOS);
});

// ================================================================
// ENDPOINT PARA TESTAR O SERVIDOR
// ================================================================
app.get("/", (req, res) => {
    res.json({
        mensagem: "🚀 RV Express Backend funcionando!",
        status: "online",
        data: new Date().toLocaleString("pt-BR"),
    });
});

// ================================================================
// INICIA O SERVIDOR
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
