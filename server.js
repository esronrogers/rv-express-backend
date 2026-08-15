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

        const bodyPagamento = {
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
        };
        if (deviceId) {
            bodyPagamento.additional_info = { device_id: deviceId };
        }

        const pagamento = await paymentClient.create({
            body: bodyPagamento,
            requestOptions: { idempotencyKey },
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
// MAQUININHA (POINT) — pagamento com cartão presente
// ================================================================
// Essa é uma API mais nova do Mercado Pago. Vamos com cuidado:
// os endpoints abaixo seguem a documentação oficial da "Point
// Integration API", mas como é uma integração nova, é normal
// precisarmos ajustar algum detalhe nos primeiros testes reais.

// 1) Lista as maquininhas vinculadas à conta — usamos isso pra
//    descobrir o "device_id" de verdade que a API usa (diferente
//    do número de série que aparece na tela do app Point).
app.get("/point/dispositivos", async (req, res) => {
    try {
        const resp = await fetch("https://api.mercadopago.com/point/integration-api/devices", {
            headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        });
        const data = await resp.json();
        console.log("📟 Dispositivos Point encontrados:", JSON.stringify(data));
        res.status(resp.status).json(data);
    } catch (erro) {
        console.error("❌ Erro ao listar dispositivos Point:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao listar dispositivos", detalhes: erro?.message });
    }
});

// 2) Cria uma "intenção de pagamento" na maquininha — ela acorda
//    mostrando o valor, e o cliente aproxima/insere o cartão nela.
app.post("/criar-pagamento-point", async (req, res) => {
    try {
        const { itens, deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ erro: "deviceId não informado" });
        }

        const calculo = calcularTotalSeguro(itens);
        if (!calculo.ok) {
            return res.status(400).json({ erro: calculo.erro });
        }
        const valor = calculo.total;
        const valorEmCentavos = Math.round(valor * 100);
        console.log("💳 Enviando cobrança para a maquininha:", valor);

        const resp = await fetch(
            `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                    "X-Idempotency-Key": crypto.randomUUID(),
                },
                body: JSON.stringify({
                    amount: valorEmCentavos,
                    description: "Compra RV Express",
                }),
            }
        );
        const data = await resp.json();
        console.log("💳 Resposta da maquininha:", JSON.stringify(data));

        if (!resp.ok) {
            return res.status(resp.status).json({ erro: "Erro ao enviar cobrança para a maquininha", detalhes: data });
        }

        res.json({ id: data.id, valor: valor, status: data.state || "pendente" });
    } catch (erro) {
        console.error("❌ Erro ao criar pagamento Point:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao processar pagamento na maquininha", detalhes: erro?.message });
    }
});

// 3) Consulta o status da cobrança na maquininha (o app fica
//    perguntando isso a cada poucos segundos, igual fizemos com o Pix).
app.get("/point/pagamento/:deviceId/:paymentIntentId", async (req, res) => {
    try {
        const { deviceId, paymentIntentId } = req.params;
        const url = `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents/${paymentIntentId}`;
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        });
        const textoBruto = await resp.text();
        console.log("🔍 Consulta status Point - URL:", url);
        console.log("🔍 Consulta status Point - HTTP:", resp.status, "- Resposta:", textoBruto);
        let data;
        try {
            data = JSON.parse(textoBruto);
        } catch (e) {
            data = { respostaCrua: textoBruto };
        }
        res.status(resp.status).json(data);
    } catch (erro) {
        console.error("❌ Erro ao consultar pagamento Point:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao consultar status na maquininha", detalhes: erro?.message || String(erro) });
    }
});

// 4) Cancela a cobrança na maquininha (usado se o cliente desistir
//    ou o app precisar abortar a espera).
app.post("/point/pagamento/:deviceId/:paymentIntentId/cancelar", async (req, res) => {
    try {
        const { deviceId, paymentIntentId } = req.params;
        const resp = await fetch(
            `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents/${paymentIntentId}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
        );
        res.sendStatus(resp.status);
    } catch (erro) {
        console.error("❌ Erro ao cancelar pagamento Point:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao cancelar cobrança na maquininha" });
    }
});

// 5) Tenta forçar a limpeza de qualquer cobrança presa na fila da
//    maquininha, sem precisar saber o ID exato dela.
app.post("/point/:deviceId/limpar-fila", async (req, res) => {
    try {
        const { deviceId } = req.params;
        const resp = await fetch(
            `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`,
            { method: "DELETE", headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
        );
        let data = {};
        try { data = await resp.json(); } catch (e) {}
        console.log("🧹 Tentativa de limpar fila:", resp.status, JSON.stringify(data));
        res.status(resp.status).json({ status: resp.status, data });
    } catch (erro) {
        console.error("❌ Erro ao limpar fila:", erro?.message || erro);
        res.status(500).json({ erro: "Erro ao limpar fila", detalhes: erro?.message });
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
