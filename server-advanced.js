const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const GeocodingServiceAdvanced = require('./geocoding-service-advanced');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurações para grandes volumes
const geocodingConfig = {
  rateLimitDelay: 1000,    // 1 segundo entre requisições
  batchSize: 100,          // Processa 100 por vez
  maxRetries: 3,           // 3 tentativas por endereço
  retryDelay: 5000,        // 5 segundos entre tentativas
  cacheEnabled: true       // Cache habilitado
};

const geocodingService = new GeocodingServiceAdvanced(geocodingConfig);

// Estado do processamento
let processamentoAtivo = false;
let progressoAtual = null;

/**
 * Carrega dados em streaming para grandes volumes
 */
async function carregarClientesOtimizado(limit = null, offset = 0) {
  try {
    const dados = await fs.readFile(path.join(__dirname, 'clientes.json'), 'utf8');
    const clientes = JSON.parse(dados);
    
    if (limit) {
      return clientes.slice(offset, offset + limit);
    }
    
    return clientes;
  } catch (error) {
    console.error('Erro ao carregar clientes:', error);
    return [];
  }
}

/**
 * Salva dados com backup automático
 */
async function salvarClientesComBackup(clientes) {
  try {
    const clientesPath = path.join(__dirname, 'clientes.json');
    const backupPath = path.join(__dirname, `clientes-backup-${Date.now()}.json`);
    
    // Cria backup
    try {
      await fs.copyFile(clientesPath, backupPath);
    } catch (error) {
      // Arquivo original não existe, ok
    }
    
    // Salva novos dados
    await fs.writeFile(clientesPath, JSON.stringify(clientes, null, 2), 'utf8');
    
    // Remove backups antigos (mantém apenas os 5 mais recentes)
    const files = await fs.readdir(__dirname);
    const backups = files
      .filter(f => f.startsWith('clientes-backup-'))
      .sort()
      .reverse();
    
    for (let i = 5; i < backups.length; i++) {
      await fs.unlink(path.join(__dirname, backups[i]));
    }
    
    return true;
  } catch (error) {
    console.error('Erro ao salvar clientes:', error);
    return false;
  }
}

// Rotas da API

/**
 * GET /api/clientes - Lista clientes com paginação
 */
app.get('/api/clientes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;
    
    const todosClientes = await carregarClientesOtimizado();
    const clientes = todosClientes.slice(offset, offset + limit);
    
    res.json({
      success: true,
      data: clientes,
      pagination: {
        page,
        limit,
        total: todosClientes.length,
        pages: Math.ceil(todosClientes.length / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar clientes'
    });
  }
});

/**
 * GET /api/estimativa - Estima tempo para processamento
 */
app.get('/api/estimativa', async (req, res) => {
  try {
    const clientes = await carregarClientesOtimizado();
    const processados = clientes.filter(c => c.geocoded && c.latitude && c.longitude).length;
    const estimativa = geocodingService.estimarTempo(clientes.length, processados);
    
    res.json({
      success: true,
      data: {
        ...estimativa,
        total: clientes.length,
        processados,
        configuracao: {
          rateLimitDelay: geocodingConfig.rateLimitDelay,
          batchSize: geocodingConfig.batchSize,
          maxRetries: geocodingConfig.maxRetries
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao calcular estimativa'
    });
  }
});

/**
 * POST /api/geocodificar-otimizado - Processamento otimizado para grandes volumes
 */
app.post('/api/geocodificar-otimizado', async (req, res) => {
  if (processamentoAtivo) {
    return res.status(400).json({
      success: false,
      error: 'Processamento já está em andamento'
    });
  }

  try {
    processamentoAtivo = true;
    progressoAtual = { processados: 0, total: 0, status: 'iniciando' };

    const { resumir = true } = req.body;
    const clientes = await carregarClientesOtimizado();
    
    console.log(`🚀 Iniciando processamento otimizado de ${clientes.length} clientes`);
    
    // Callback de progresso com salvamento incremental
    const onProgress = async (progresso) => {
      progressoAtual = progresso;
      
      // Salva dados a cada 10 clientes processados
      if (progresso.processados % 10 === 0) {
        await salvarClientesComBackup(clientes);
        console.log(`💾 Dados salvos automaticamente (${progresso.processados} processados)`);
      }
      
      // Ajusta rate limiting dinamicamente
      if (progresso.processados % 50 === 0) {
        geocodingService.ajustarRateLimit();
      }
    };

    // Inicia processamento em background
    geocodingService.processarClientesOtimizado(clientes, onProgress, resumir)
      .then(async (clientesProcessados) => {
        await salvarClientesComBackup(clientesProcessados);
        processamentoAtivo = false;
        progressoAtual = {
          ...progressoAtual,
          status: 'concluido',
          concluido: true,
          estatisticas: geocodingService.stats
        };
        console.log('✅ Processamento otimizado concluído e dados salvos');
      })
      .catch(async (error) => {
        console.error('❌ Erro no processamento:', error);
        
        // Salva progresso mesmo com erro
        await salvarClientesComBackup(clientes);
        
        processamentoAtivo = false;
        progressoAtual = {
          ...progressoAtual,
          status: 'erro',
          erro: error.message
        };
      });

    res.json({
      success: true,
      message: 'Processamento otimizado iniciado',
      configuracao: geocodingConfig,
      estimativa: geocodingService.estimarTempo(clientes.length)
    });

  } catch (error) {
    processamentoAtivo = false;
    res.status(500).json({
      success: false,
      error: 'Erro ao iniciar geocodificação otimizada'
    });
  }
});

/**
 * GET /api/progresso-detalhado - Progresso com estatísticas detalhadas
 */
app.get('/api/progresso-detalhado', (req, res) => {
  res.json({
    success: true,
    ativo: processamentoAtivo,
    progresso: progressoAtual,
    configuracao: geocodingConfig,
    estatisticas: geocodingService.stats
  });
});

/**
 * GET /api/relatorio-detalhado - Relatório completo
 */
app.get('/api/relatorio-detalhado', async (req, res) => {
  try {
    const clientes = await carregarClientesOtimizado();
    const relatorio = geocodingService.gerarRelatorioDetalhado(clientes);
    
    res.json({
      success: true,
      data: relatorio
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório detalhado'
    });
  }
});

/**
 * POST /api/limpar-cache - Limpa cache para reprocessar
 */
app.post('/api/limpar-cache', async (req, res) => {
  try {
    await geocodingService.limparCache();
    res.json({
      success: true,
      message: 'Cache limpo com sucesso'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao limpar cache'
    });
  }
});

/**
 * GET /api/status-sistema - Status do sistema e performance
 */
app.get('/api/status-sistema', async (req, res) => {
  try {
    const clientes = await carregarClientesOtimizado();
    const memoryUsage = process.memoryUsage();
    
    res.json({
      success: true,
      data: {
        totalClientes: clientes.length,
        processamentoAtivo,
        memoria: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        configuracao: geocodingConfig,
        ultimoProcessamento: progressoAtual,
        uptime: Math.round(process.uptime()) + ' segundos'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter status do sistema'
    });
  }
});

/**
 * PUT /api/configuracao - Atualiza configuração em tempo real
 */
app.put('/api/configuracao', (req, res) => {
  try {
    const { rateLimitDelay, batchSize, maxRetries } = req.body;
    
    if (rateLimitDelay && rateLimitDelay >= 500) {
      geocodingConfig.rateLimitDelay = rateLimitDelay;
      geocodingService.rateLimitDelay = rateLimitDelay;
    }
    
    if (batchSize && batchSize >= 10 && batchSize <= 1000) {
      geocodingConfig.batchSize = batchSize;
      geocodingService.batchSize = batchSize;
    }
    
    if (maxRetries && maxRetries >= 1 && maxRetries <= 10) {
      geocodingConfig.maxRetries = maxRetries;
      geocodingService.maxRetries = maxRetries;
    }
    
    res.json({
      success: true,
      configuracao: geocodingConfig,
      message: 'Configuração atualizada'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar configuração'
    });
  }
});

// Middleware de monitoramento de performance
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) { // Log requisições lentas
      console.log(`⚠️  Requisição lenta: ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  
  next();
});

// Rotas do sistema original (compatibilidade)
app.post('/api/geocodificar', async (req, res) => {
  // Redireciona para a versão otimizada
  if (processamentoAtivo) {
    return res.status(400).json({
      success: false,
      error: 'Processamento já está em andamento'
    });
  }

  try {
    processamentoAtivo = true;
    progressoAtual = { processados: 0, total: 0, status: 'iniciando' };

    const clientes = await carregarClientesOtimizado();
    
    console.log(`🚀 Iniciando processamento (compatibilidade) de ${clientes.length} clientes`);
    
    // Callback de progresso com salvamento incremental
    const onProgress = async (progresso) => {
      progressoAtual = progresso;
      
      // Salva dados a cada 10 clientes processados
      if (progresso.processados % 10 === 0) {
        await salvarClientesComBackup(clientes);
      }
    };

    // Inicia processamento em background
    geocodingService.processarClientesOtimizado(clientes, onProgress, true)
      .then(async (clientesProcessados) => {
        await salvarClientesComBackup(clientesProcessados);
        processamentoAtivo = false;
        progressoAtual = {
          ...progressoAtual,
          status: 'concluido',
          concluido: true,
          estatisticas: geocodingService.stats
        };
        console.log('✅ Processamento (compatibilidade) concluído e dados salvos');
      })
      .catch(async (error) => {
        console.error('❌ Erro no processamento:', error);
        
        // Salva progresso mesmo com erro
        await salvarClientesComBackup(clientes);
        
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

app.get('/api/clientes-todos', async (req, res) => {
  try {
    const clientes = await carregarClientesOtimizado();
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

app.get('/api/relatorio', async (req, res) => {
  try {
    const clientes = await carregarClientesOtimizado();
    const total = clientes.length;
    const geocodificados = clientes.filter(c => c.geocoded && c.latitude && c.longitude).length;
    
    res.json({
      success: true,
      data: {
        total,
        geocodificados,
        naoGeocodificados: total - geocodificados,
        taxaSucesso: `${((geocodificados / total) * 100).toFixed(1)}%`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório'
    });
  }
});

app.get('/api/progresso', (req, res) => {
  res.json({
    success: true,
    ativo: processamentoAtivo,
    progresso: progressoAtual
  });
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-advanced.html'));
});

// Middleware de erro
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Recebido sinal de parada...');
  
  if (processamentoAtivo) {
    console.log('💾 Salvando progresso antes de parar...');
    try {
      const clientes = await carregarClientesOtimizado();
      await salvarClientesComBackup(clientes);
      await geocodingService.saveCache();
    } catch (error) {
      console.error('❌ Erro ao salvar:', error.message);
    }
  }
  
  process.exit(0);
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor OTIMIZADO rodando em http://localhost:${PORT}`);
  console.log(`📍 Sistema preparado para GRANDES VOLUMES`);
  console.log(`🔧 Configuração atual:`);
  console.log(`   - Rate limit: ${geocodingConfig.rateLimitDelay}ms`);
  console.log(`   - Lotes: ${geocodingConfig.batchSize} registros`);
  console.log(`   - Tentativas: ${geocodingConfig.maxRetries}x`);
  console.log(`   - Cache: ${geocodingConfig.cacheEnabled ? 'Habilitado' : 'Desabilitado'}`);
  console.log(`🌐 API: Nominatim OpenStreetMap (open source)`);
});

module.exports = app;
