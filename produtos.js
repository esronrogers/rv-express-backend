// ================================================================
// CATÁLOGO DE PRODUTOS — agora fica salvo em um arquivo (data/produtos.json)
// e pode ser alterado pelo painel Administrar do app, sem precisar
// mexer em código toda vez que você adiciona um produto novo.
// ================================================================
const fs = require("fs");
const path = require("path");

const PASTA_DADOS = path.join(__dirname, "data");
const ARQUIVO_PRODUTOS = path.join(PASTA_DADOS, "produtos.json");

// Lista usada apenas na primeiríssima vez que o servidor roda,
// caso o arquivo produtos.json ainda não exista.
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

function garantirArquivo() {
    if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true });
    if (!fs.existsSync(ARQUIVO_PRODUTOS)) {
        fs.writeFileSync(ARQUIVO_PRODUTOS, JSON.stringify(PRODUTOS_PADRAO, null, 2));
    }
}

function obterProdutos() {
    garantirArquivo();
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_PRODUTOS, "utf-8"));
    } catch (e) {
        console.error("⚠️ Erro ao ler produtos.json, usando lista padrão:", e.message);
        return JSON.parse(JSON.stringify(PRODUTOS_PADRAO));
    }
}

function salvarProdutosEmDisco(lista) {
    garantirArquivo();
    fs.writeFileSync(ARQUIVO_PRODUTOS, JSON.stringify(lista, null, 2));
}

function buscarProduto(codigo) {
    return obterProdutos().find(p => p.codigo === String(codigo).trim());
}

function adicionarProduto({ codigo, nome, preco, imagem, detalhe }) {
    const lista = obterProdutos();
    if (lista.find(p => p.codigo === codigo)) {
        return { ok: false, erro: "Já existe um produto com esse código de barras" };
    }
    lista.push({ codigo, nome, preco, imagem: imagem || "📦", detalhe: detalhe || "" });
    salvarProdutosEmDisco(lista);
    return { ok: true, produtos: lista };
}

function atualizarProduto(codigoAtual, { codigo, nome, preco, imagem, detalhe }) {
    const lista = obterProdutos();
    const index = lista.findIndex(p => p.codigo === codigoAtual);
    if (index === -1) return { ok: false, erro: "Produto não encontrado" };
    if (codigo !== codigoAtual && lista.find(p => p.codigo === codigo)) {
        return { ok: false, erro: "Já existe outro produto com esse código de barras" };
    }
    lista[index] = { codigo, nome, preco, imagem: imagem || "📦", detalhe: detalhe || "" };
    salvarProdutosEmDisco(lista);
    return { ok: true, produtos: lista };
}

function removerProduto(codigo) {
    const lista = obterProdutos();
    const nova = lista.filter(p => p.codigo !== codigo);
    if (nova.length === lista.length) return { ok: false, erro: "Produto não encontrado" };
    salvarProdutosEmDisco(nova);
    return { ok: true, produtos: nova };
}

function restaurarPadrao() {
    salvarProdutosEmDisco(JSON.parse(JSON.stringify(PRODUTOS_PADRAO)));
    return obterProdutos();
}

// Recebe os itens do carrinho [{codigo, qtd}] e calcula o total
// usando sempre o preço salvo no servidor — nunca o que o app manda.
function calcularTotalSeguro(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
        return { ok: false, erro: "Carrinho vazio ou inválido" };
    }
    const catalogo = obterProdutos();
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
