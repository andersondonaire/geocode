const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const GeocodingService = require('./geocoding-service');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Instância do serviço de geocodificação
const geocodingService = new GeocodingService();

// Variável para controlar status do processamento
let processamentoAtivo = false;
let progressoAtual = null;

/**
 * Carrega dados dos clientes do arquivo JSON
 */
async function carregarClientes() {
  try {
    const dados = await fs.readFile(path.join(__dirname, 'clientes.json'), 'utf8');
    return JSON.parse(dados);
  } catch (error) {
    console.error('Erro ao carregar clientes:', error);
    return [];
  }
}

/**
 * Salva dados dos clientes no arquivo JSON
 */
async function salvarClientes(clientes) {
  try {
    await fs.writeFile(
      path.join(__dirname, 'clientes.json'),
      JSON.stringify(clientes, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error('Erro ao salvar clientes:', error);
    return false;
  }
}

// Rotas da API

/**
 * GET /api/clientes - Lista todos os clientes
 */
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await carregarClientes();
    res.json({
      success: true,
      data: clientes,
      total: clientes.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar clientes'
    });
  }
});

/**
 * GET /api/relatorio - Gera relatório de geocodificação
 */
app.get('/api/relatorio', async (req, res) => {
  try {
    const clientes = await carregarClientes();
    const relatorio = geocodingService.gerarRelatorio(clientes);
    res.json({
      success: true,
      data: relatorio
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório'
    });
  }
});

/**
 * POST /api/geocodificar - Inicia processo de geocodificação
 */
app.post('/api/geocodificar', async (req, res) => {
  if (processamentoAtivo) {
    return res.status(400).json({
      success: false,
      error: 'Processamento já está em andamento'
    });
  }

  try {
    processamentoAtivo = true;
    progressoAtual = { processados: 0, total: 0, status: 'iniciando' };

    const clientes = await carregarClientes();
    
    // Callback de progresso
    const onProgress = (progresso) => {
      progressoAtual = progresso;
      console.log(`Progresso: ${progresso.processados}/${progresso.total} - ${progresso.atual}`);
    };

    // Inicia processamento em background
    geocodingService.processarClientes(clientes, onProgress)
      .then(async (clientesProcessados) => {
        await salvarClientes(clientesProcessados);
        processamentoAtivo = false;
        progressoAtual = {
          ...progressoAtual,
          status: 'concluido',
          concluido: true
        };
        console.log('✅ Processamento concluído e dados salvos');
      })
      .catch((error) => {
        console.error('❌ Erro no processamento:', error);
        processamentoAtivo = false;
        progressoAtual = {
          ...progressoAtual,
          status: 'erro',
          erro: error.message
        };
      });

    res.json({
      success: true,
      message: 'Processamento iniciado',
      estimativa: `${clientes.length} clientes serão processados`
    });

  } catch (error) {
    processamentoAtivo = false;
    res.status(500).json({
      success: false,
      error: 'Erro ao iniciar geocodificação'
    });
  }
});

/**
 * GET /api/progresso - Consulta progresso do processamento
 */
app.get('/api/progresso', (req, res) => {
  res.json({
    success: true,
    ativo: processamentoAtivo,
    progresso: progressoAtual
  });
});

/**
 * POST /api/geocodificar/cliente/:id - Geocodifica um cliente específico
 */
app.post('/api/geocodificar/cliente/:id', async (req, res) => {
  try {
    const clienteId = parseInt(req.params.id);
    const clientes = await carregarClientes();
    const cliente = clientes.find(c => c.id === clienteId);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }

    const coordenadas = await geocodingService.buscarCoordenadas(cliente.endereco);
    
    if (coordenadas) {
      cliente.latitude = coordenadas.latitude;
      cliente.longitude = coordenadas.longitude;
      cliente.endereco_formatado = coordenadas.endereco_formatado;
      cliente.confianca = coordenadas.confianca;
      cliente.geocoded = true;
      cliente.data_geocodificacao = new Date().toISOString();

      await salvarClientes(clientes);

      res.json({
        success: true,
        data: cliente,
        coordenadas
      });
    } else {
      res.json({
        success: false,
        error: 'Não foi possível encontrar coordenadas para este endereço'
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao geocodificar cliente'
    });
  }
});

/**
 * PUT /api/cliente/:id - Atualiza dados de um cliente
 */
app.put('/api/cliente/:id', async (req, res) => {
  try {
    const clienteId = parseInt(req.params.id);
    const clientes = await carregarClientes();
    const index = clientes.findIndex(c => c.id === clienteId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }

    clientes[index] = { ...clientes[index], ...req.body };
    await salvarClientes(clientes);

    res.json({
      success: true,
      data: clientes[index]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar cliente'
    });
  }
});

// Rota principal - serve a interface web
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware de erro
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor'
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📍 Sistema de Geocodificação iniciado`);
  console.log(`🌐 API: Nominatim OpenStreetMap (open source)`);
  console.log(`⏱️  Rate limit: 1 requisição por segundo`);
});

module.exports = app;
