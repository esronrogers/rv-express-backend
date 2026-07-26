const express = require("express");
const cors = require("cors");
const mercadopago = require("mercadopago");

const app = express();

app.use(cors());
app.use(express.json());

// ================================================================
// CONFIGURAÇÃO DO MERCADO PAGO
// ================================================================
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

// ================================================================
// ENDPOINT PARA CRIAR PAGAMENTO COM CARTÃO
// ================================================================
app.post("/criar-pagamento", async (req, res) => {
    try {
        console.log("📱 Recebendo pagamento com cartão...");
        console.log("💰 Valor:", req.body.valor);
        console.log("💳 Bandeira:", req.body.payment_method_id);

        const pagamento = await mercadopago.payment.create({
            transaction_amount: Number(req.body.valor),
            token: req.body.token,
            description: req.body.descricao || "Compra RV Express",
            installments: 1,
            payment_method_id: req.body.payment_method_id || "visa",
            payer: {
                email: req.body.email || "cliente@rvexpress.com",
                identification: {
                    type: "CPF",
                    number: req.body.cpf || "12345678909"
                },
                first_name: req.body.nome || "Cliente"
            }
        });

        console.log("✅ Pagamento criado! Status:", pagamento.response.status);
        res.json(pagamento.response);

    } catch (erro) {
        console.error("❌ Erro:", erro.message);
        res.status(500).json({
            erro: "Erro ao processar pagamento",
            detalhes: erro.message
        });
    }
});

// ================================================================
// ENDPOINT PARA CRIAR PIX
// ================================================================
app.post("/criar-pix", async (req, res) => {
    try {
        console.log("📱 Criando PIX...");
        console.log("💰 Valor:", req.body.valor);

        const pix = await mercadopago.payment.create({
            transaction_amount: Number(req.body.valor),
            description: req.body.descricao || "Compra RV Express - PIX",
            payment_method_id: "pix",
            payer: {
                email: req.body.email || "cliente@rvexpress.com",
                first_name: req.body.nome || "Cliente",
                identification: {
                    type: "CPF",
                    number: req.body.cpf || "12345678909"
                }
            }
        });

        console.log("✅ PIX criado! Status:", pix.response.status);

        const qrCode = pix.response.point_of_interaction?.transaction_data?.qr_code || "";
        const qrCodeBase64 = pix.response.point_of_interaction?.transaction_data?.qr_code_base64 || "";

        res.json({
            status: pix.response.status,
            id: pix.response.id,
            qr_code: qrCode,
            qr_code_base64: qrCodeBase64,
            valor: req.body.valor
        });

    } catch (erro) {
        console.error("❌ Erro ao criar PIX:", erro.message);
        res.status(500).json({
            erro: "Erro ao criar PIX",
            detalhes: erro.message
        });
    }
});

// ================================================================
// ENDPOINT PARA TESTAR O SERVIDOR
// ================================================================
app.get("/", (req, res) => {
    res.json({ 
        mensagem: "🚀 RV Express Backend funcionando!",
        status: "online",
        data: new Date().toLocaleString()
    });
});

// ================================================================
// INICIA O SERVIDOR
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
