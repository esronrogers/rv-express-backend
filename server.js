const express = require("express");
const cors = require("cors");
const mercadopago = require("mercadopago");

const app = express();

app.use(cors());
app.use(express.json());

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

app.post("/criar-pagamento", async (req, res) => {
    try {
        const pagamento = await mercadopago.payment.create({
            transaction_amount: req.body.valor,
            token: req.body.token,
            description: req.body.descricao || "Compra RV Express",
            installments: 1,
            payment_method_id: req.body.payment_method_id || "visa",
            payer: {
                email: req.body.email || "cliente@rvexpress.com"
            }
        });

        res.json(pagamento.response);
    } catch (erro) {
        res.status(500).json({
            erro: "Erro ao processar pagamento",
            detalhes: erro.response ? erro.response.data : erro.message
        });
    }
});

app.get("/", (req, res) => {
    res.json({ 
        mensagem: "🚀 RV Express Backend funcionando!"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
