const PRODUTOS = [
    { codigo: '7891000123456', nome: 'Coca-Cola 350ml',        preco: 6.50 },
    { codigo: '7891000654321', nome: 'Heineken 350ml',         preco: 7.00 },
    { codigo: '7891000789012', nome: 'Água Mineral 500ml',     preco: 2.50 },
    { codigo: '7891000890123', nome: 'Suco Natural 1L',        preco: 5.90 },
    { codigo: '7891000987654', nome: 'BIS Original',           preco: 4.00 },
    { codigo: '7891000543210', nome: 'Pão de Queijo',          preco: 3.50 },
    { codigo: '7891000666555', nome: 'Refrigerante 2L',        preco: 8.90 },
    { codigo: '7891000777666', nome: 'Salgadinho Cebola',      preco: 4.50 },
];

function buscarProduto(codigo) {
    return PRODUTOS.find(p => p.codigo === String(codigo).trim());
}

function calcularTotalSeguro(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
        return { ok: false, erro: 'Carrinho vazio ou inválido' };
    }
    let total = 0;
    for (const item of itens) {
        const produto = buscarProduto(item.codigo);
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

module.exports = { PRODUTOS, buscarProduto, calcularTotalSeguro };
