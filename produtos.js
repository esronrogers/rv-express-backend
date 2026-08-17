// ================================================================
// CATÁLOGO DE PRODUTOS — salvo no Firebase Realtime Database
// (nuvem, gratuito), usando o SDK oficial de administrador do
// Firebase. Isso resolve o problema de produtos "sumirem" quando
// o servidor Render reinicia.
// ================================================================
const admin = require("firebase-admin");
const fs = require("fs");

let db = null;

// Inicializa a conexão com o Firebase (só precisa fazer isso uma
// vez, na primeira chamada). A URL vem de uma variável de ambiente,
// e a chave de acesso vem de um "Secret File" configurado no Render.
function inicializarFirebase() {
    if (admin.apps.length > 0) {
        db = admin.database();
        return;
    }
    if (!process.env.FIREBASE_DATABASE_URL) {
        throw new Error("FIREBASE_DATABASE_URL não configurada nas variáveis de ambiente do Render.");
    }
    const caminhoChave = "/etc/secrets/firebase-service-account.json";
    if (!fs.existsSync(caminhoChave)) {
        throw new Error(
            "Arquivo de credenciais do Firebase não encontrado em " + caminhoChave +
            " — confira se o Secret File foi criado no Render com esse nome exato."
        );
    }
    const serviceAccount = JSON.parse(fs.readFileSync(caminhoChave, "utf-8"));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    db = admin.database();
}

// Lista usada apenas na primeiríssima vez, caso o Firebase ainda
// esteja vazio (nunca foi inicializado).
const PRODUTOS_PADRAO = [
    { codigo: '7891000123456', nome: 'Coca-Cola 350ml',    preco: 6.50, imagem: '🥤', detalhe: 'Lata' },
    { codigo: '7891000654321', nome: 'Heineken 350ml',     preco: 7.00, imagem: '🍺', detalhe: 'Lata' },
    { codigo: '7891000789012', nome: 'Água Mineral 500ml', preco: 2.50, imagem: '💧', detalhe: 'Garrafa' },
    { codigo: '7891000890123', nome: 'Suco Natural 1L',    preco: 5.90, imagem: '🧃', detalhe: 'Garrafa' },
    { codigo: '7891000987654', nome: 'BIS Original',       preco: 4.00, imagem: '🍫', detalhe: 'Pacote' },
    { codigo: '7891000543210', nome: 'Pão de Queijo',      preco: 3.50, imagem: '🥐', detalhe: 'Unidade' },
    { codigo: '7891000666555', nome: 'Refrigerante 2L',    preco: 8.90, imagem: '🥤', detalhe: 'Garrafa' },
    { codigo: '7891000777666', nome: 'Salgadinho Cebola',  preco: 4.50, imagem: '🍿', detalhe: 'Pacote 100g' },
];

async function obterProdutos() {
    inicializarFirebase();
    const snapshot = await db.ref("produtos").once("value");
    const dados = snapshot.val();

    if (!dados) {
        await salvarProdutos(PRODUTOS_PADRAO);
        return JSON.parse(JSON.stringify(PRODUTOS_PADRAO));
    }

    return Array.isArray(dados) ? dados.filter(Boolean) : Object.values(dados);
}

async function salvarProdutos(lista) {
    inicializarFirebase();
    await db.ref("produtos").set(lista);
}

async function buscarProduto(codigo) {
    const lista = await obterProdutos();
    return lista.find(p => p.codigo === String(codigo).trim());
}

async function adicionarProduto({ codigo, nome, preco, imagem, detalhe }) {
    const lista = await obterProdutos();
    if (lista.find(p => p.codigo === codigo)) {
        return { ok: false, erro: "Já existe um produto com esse código de barras" };
    }
    lista.push({ codigo, nome, preco, imagem: imagem || "📦", detalhe: detalhe || "" });
    await salvarProdutos(lista);
    return { ok: true, produtos: lista };
}

async function atualizarProduto(codigoAtual, { codigo, nome, preco, imagem, detalhe }) {
    const lista = await obterProdutos();
    const index = lista.findIndex(p => p.codigo === codigoAtual);
    if (index === -1) return { ok: false, erro: "Produto não encontrado" };
    if (codigo !== codigoAtual && lista.find(p => p.codigo === codigo)) {
        return { ok: false, erro: "Já existe outro produto com esse código de barras" };
    }
    lista[index] = { codigo, nome, preco, imagem: imagem || "📦", detalhe: detalhe || "" };
    await salvarProdutos(lista);
    return { ok: true, produtos: lista };
}

async function removerProduto(codigo) {
    const lista = await obterProdutos();
    const nova = lista.filter(p => p.codigo !== codigo);
    if (nova.length === lista.length) return { ok: false, erro: "Produto não encontrado" };
    await salvarProdutos(nova);
    return { ok: true, produtos: nova };
}

async function restaurarPadrao() {
    await salvarProdutos(PRODUTOS_PADRAO);
    return JSON.parse(JSON.stringify(PRODUTOS_PADRAO));
}

async function calcularTotalSeguro(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
        return { ok: false, erro: "Carrinho vazio ou inválido" };
    }
    const catalogo = await obterProdutos();
    let total = 0;
    for (const item of itens) {
        const produto = catalogo.find(p => p.codigo === String(item.codigo).trim());
        if (!produto) {
            return { ok: false, erro: `Produto com código ${item.codigo} não encontrado` };
        }
        const qtd = Number(item.qtd);
        if (!Number.isInteger(qtd) || qtd <= 0 || qtd > 100) {
            return { ok: false, erro: `Quantidade inválida para ${produto.nome}` };
        }
        total += produto.preco * qtd;
    }
    return { ok: true, total: Math.round(total * 100) / 100 };
}

module.exports = {
    obterProdutos,
    buscarProduto,
    adicionarProduto,
    atualizarProduto,
    removerProduto,
    restaurarPadrao,
    calcularTotalSeguro,
};
