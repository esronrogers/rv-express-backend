require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago"); // SDK v2
const {
    calcularTotalSeguro,
    obterProdutos,
    adicionarProduto,
    atualizarProduto,
    removerProduto,
    restaurarPadrao,
} = require("./produtos");

const app = express();
app.use(cors()); // em produção, troque por: cors({ origin: "https://SEU-APP.com" })
app.use(express.json());

// ================================================================
// VALIDAÇÃO DO AMBIENTE
// ================================================================
if (!process.env.MP_ACCESS_TOKEN) {
    console.error("❌ ERRO FATAL: variável de ambiente MP_ACCESS_TOKEN não definida.");
    process.exit(1);
}

// Senha do painel Administrar. Defina ADMIN_SENHA nas variáveis de
// ambiente do Render com a MESMA senha que você usa pra entrar no
// admin do app. Se não definir, usa "admin123" como padrão (troque!).
const ADMIN_SENHA = process.env.ADMIN_SENHA || "admin123";

// ================================================================
// CONFIGURAÇÃO DO MERCADO PAGO (SDK v2)
// ================================================================
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(client);

// Middleware simples que protege as rotas de administração de produtos.
// O app precisa mandar a senha no cabeçalho "x-admin-key".
function protegerAdmin(req, res, next) {
    const chave = req.headers["x-admin-key"];
    if (chave !== ADMIN_SENHA) {
        return res.status(401).json({ erro: "Senha de administrador inválida" });
    }
    next();
}

// ================================================================
// ENDPOINT PARA CRIAR PAGAMENTO COM CARTÃO
// ================================================================
app.post("/criar-pagamento", async (req, res) => {
    try {
        const { token, payment_method_id, email, cpf, nome, itens, deviceId } = req.body;

        console.log("📱 Recebendo pagamento com cartão...");

        if (!token) {
            return res.status(400).json({ erro: "Token do cartão não informado" });
        }

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

        const requestOptions = { idempotencyKey };
        if (deviceId) {
            requestOptions.headers = { 'X-meli-session-id': deviceId };
        }

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
            requestOptions: requestOptions,
        });

        console.log("✅ Pagamento criado! Status:", pagamento.status);
        res.json(pagamento);
    } catch (erro) {
        console.error("❌ Erro ao criar pagamento:", erro?.message || erro);
        console.error(erro);
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
            requestOptions: { idempotencyKey },
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
// CONSULTAR STATUS DE UM PAGAMENTO (usado pelo app para saber se
// o PIX já foi pago de verdade, em vez de simular com um timer)
// ================================================================
app.get("/pagamento/:id", async (req, res) => {
    try {
        const pagamento = await paymentClient.get({ id: req.params.id });
        res.json({ status: pagamento.status, id: pagamento.id });
    } catch (erro) {
        console.error("❌ Erro ao consultar pagamento:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao consultar status do pagamento" });
    }
});

// ================================================================
// WEBHOOK
// ================================================================
app.post("/webhook", async (req, res) => {
    try {
        console.log("🔔 Webhook recebido:", JSON.stringify(req.body));
        const { type, data } = req.body;
        if (type === "payment" && data?.id) {
            const pagamento = await paymentClient.get({ id: data.id });
            console.log(`   Pagamento ${data.id} -> status: ${pagamento.status}`);
        }
        res.sendStatus(200);
    } catch (erro) {
        console.error("❌ Erro no webhook:", erro?.message || erro);
        res.sendStatus(200);
    }
});

// ================================================================
// PRODUTOS — leitura pública (o app usa isso pra montar a vitrine)
// ================================================================
app.get("/produtos", (req, res) => {
    res.json(obterProdutos());
});

// ================================================================
// PRODUTOS — administração (criar, editar, excluir, restaurar)
// Protegido pela senha do admin, enviada no cabeçalho x-admin-key.
// ================================================================
app.post("/produtos", protegerAdmin, (req, res) => {
    const { codigo, nome, preco, imagem, detalhe } = req.body;
    if (!codigo || !nome || typeof preco !== "number" || preco <= 0) {
        return res.status(400).json({ erro: "Dados do produto inválidos" });
    }
    const resultado = adicionarProduto({ codigo, nome, preco, imagem, detalhe });
    if (!resultado.ok) return res.status(409).json({ erro: resultado.erro });
    res.json(resultado);
});

app.put("/produtos/:codigo", protegerAdmin, (req, res) => {
    const { codigo, nome, preco, imagem, detalhe } = req.body;
    if (!codigo || !nome || typeof preco !== "number" || preco <= 0) {
        return res.status(400).json({ erro: "Dados do produto inválidos" });
    }
    const resultado = atualizarProduto(req.params.codigo, { codigo, nome, preco, imagem, detalhe });
    if (!resultado.ok) return res.status(404).json({ erro: resultado.erro });
    res.json(resultado);
});

app.delete("/produtos/:codigo", protegerAdmin, (req, res) => {
    const resultado = removerProduto(req.params.codigo);
    if (!resultado.ok) return res.status(404).json({ erro: resultado.erro });
    res.json(resultado);
});

app.post("/produtos/restaurar-padrao", protegerAdmin, (req, res) => {
    const produtos = restaurarPadrao();
    res.json({ ok: true, produtos });
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
