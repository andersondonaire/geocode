const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class GeocodingServiceAdvanced {
  constructor(options = {}) {
    this.baseURL = 'https://nominatim.openstreetmap.org/search';
    this.rateLimitDelay = options.rateLimitDelay || 1000;
    this.userAgent = 'BuscaLatLon/2.0.0';
    this.batchSize = options.batchSize || 100; // Processa em lotes
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheFile = options.cacheFile || 'geocoding-cache.json';
    this.progressFile = options.progressFile || 'geocoding-progress.json';
    
    // Cache em memória para evitar requisições duplicadas
    this.memoryCache = new Map();
    
    // Estatísticas
    this.stats = {
      total: 0,
      processed: 0,
      success: 0,
      errors: 0,
      cached: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Carrega cache do disco
   */
  async loadCache() {
    if (!this.cacheEnabled) return;
    
    try {
      const cacheData = await fs.readFile(this.cacheFile, 'utf8');
      const cache = JSON.parse(cacheData);
      
      for (const [key, value] of Object.entries(cache)) {
        this.memoryCache.set(key, value);
      }
      
      console.log(`📦 Cache carregado: ${this.memoryCache.size} endereços`);
    } catch (error) {
      console.log('📦 Nenhum cache encontrado, iniciando novo cache');
    }
  }

  /**
   * Salva cache no disco
   */
  async saveCache() {
    if (!this.cacheEnabled || this.memoryCache.size === 0) return;
    
    try {
      const cacheObject = Object.fromEntries(this.memoryCache);
      await fs.writeFile(this.cacheFile, JSON.stringify(cacheObject, null, 2));
      console.log(`💾 Cache salvo: ${this.memoryCache.size} endereços`);
    } catch (error) {
      console.error('❌ Erro ao salvar cache:', error.message);
    }
  }

  /**
   * Gera chave de cache para um endereço
   */
  getCacheKey(endereco) {
    return endereco.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Verifica cache antes de fazer requisição
   */
  async buscarCoordenadasComCache(endereco) {
    const cacheKey = this.getCacheKey(endereco);
    
    // Verifica cache em memória
    if (this.memoryCache.has(cacheKey)) {
      console.log(`🎯 Cache hit: ${endereco}`);
      this.stats.cached++;
      return this.memoryCache.get(cacheKey);
    }

    // Faz requisição real
    const resultado = await this.buscarCoordenadas(endereco);
    
    // Salva no cache
    if (resultado && this.cacheEnabled) {
      this.memoryCache.set(cacheKey, resultado);
    }
    
    return resultado;
  }

  /**
   * Busca coordenadas com retry automático
   */
  async buscarCoordenadas(endereco, tentativa = 1) {
    try {
      console.log(`🔍 Buscando coordenadas para: ${endereco} (tentativa ${tentativa})`);
      
      const params = {
        q: `${endereco}, Brasil`,
        format: 'json',
        addressdetails: 1,
        limit: 1,
        countrycodes: 'br'
      };

      const headers = {
        'User-Agent': this.userAgent
      };

      const response = await axios.get(this.baseURL, {
        params,
        headers,
        timeout: 15000 // Timeout aumentado para 15s
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        this.stats.success++;
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          endereco_formatado: result.display_name,
          confianca: result.importance || 0,
          cached: false
        };
      }

      console.log(`❌ Nenhum resultado encontrado para: ${endereco}`);
      this.stats.errors++;
      return null;

    } catch (error) {
      console.error(`❌ Erro ao buscar "${endereco}" (tentativa ${tentativa}):`, error.message);
      
      // Retry automático
      if (tentativa < this.maxRetries) {
        console.log(`🔄 Tentando novamente em ${this.retryDelay}ms...`);
        await this.sleep(this.retryDelay);
        return this.buscarCoordenadas(endereco, tentativa + 1);
      }
      
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Salva progresso durante o processamento
   */
  async saveProgress(processedIds, currentBatch) {
    const progress = {
      processedIds,
      currentBatch,
      timestamp: new Date().toISOString(),
      stats: { ...this.stats }
    };
    
    try {
      await fs.writeFile(this.progressFile, JSON.stringify(progress, null, 2));
    } catch (error) {
      console.error('❌ Erro ao salvar progresso:', error.message);
    }
  }

  /**
   * Carrega progresso anterior
   */
  async loadProgress() {
    try {
      const progressData = await fs.readFile(this.progressFile, 'utf8');
      return JSON.parse(progressData);
    } catch (error) {
      return null;
    }
  }

  /**
   * Processa clientes em lotes otimizados
   */
  async processarClientesOtimizado(clientes, onProgress = null, resumeFromProgress = true) {
    this.stats.total = clientes.length;
    this.stats.processed = 0;
    this.stats.success = 0;
    this.stats.errors = 0;
    this.stats.cached = 0;
    this.stats.startTime = new Date();

    console.log(`📍 Iniciando geocodificação otimizada de ${clientes.length} clientes...`);
    console.log(`📦 Lotes de ${this.batchSize} registros`);
    console.log(`⏱️  Rate limit: ${this.rateLimitDelay}ms entre requisições`);
    console.log(`🔄 Máximo de ${this.maxRetries} tentativas por endereço`);

    // Carrega cache e progresso
    await this.loadCache();
    
    let processedIds = new Set();
    let startBatch = 0;
    
    if (resumeFromProgress) {
      const progress = await this.loadProgress();
      if (progress) {
        processedIds = new Set(progress.processedIds);
        startBatch = progress.currentBatch || 0;
        console.log(`🔄 Retomando do lote ${startBatch}, ${processedIds.size} já processados`);
      }
    }

    // Filtra clientes não processados
    const clientesPendentes = clientes.filter(cliente => 
      !processedIds.has(cliente.id) && 
      (!cliente.geocoded || !cliente.latitude || !cliente.longitude)
    );

    console.log(`📊 ${clientesPendentes.length} clientes pendentes de processamento`);

    // Processa em lotes
    const totalBatches = Math.ceil(clientesPendentes.length / this.batchSize);
    
    for (let batchIndex = Math.floor(startBatch); batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * this.batchSize;
      const end = Math.min(start + this.batchSize, clientesPendentes.length);
      const lote = clientesPendentes.slice(start, end);

      console.log(`\n📦 Processando lote ${batchIndex + 1}/${totalBatches} (${lote.length} clientes)`);

      // Processa lote
      for (const cliente of lote) {
        // Verifica se já foi processado
        if (processedIds.has(cliente.id)) {
          continue;
        }

        // Busca coordenadas
        const coordenadas = await this.buscarCoordenadasComCache(cliente.endereco);
        
        // Atualiza cliente
        if (coordenadas) {
          cliente.latitude = coordenadas.latitude;
          cliente.longitude = coordenadas.longitude;
          cliente.endereco_formatado = coordenadas.endereco_formatado;
          cliente.confianca = coordenadas.confianca;
          cliente.geocoded = true;
          cliente.data_geocodificacao = new Date().toISOString();
          cliente.cached = coordenadas.cached;
        } else {
          cliente.geocoded = false;
          cliente.data_geocodificacao = new Date().toISOString();
        }

        processedIds.add(cliente.id);
        this.stats.processed++;

        // Callback de progresso
        if (onProgress) {
          onProgress({
            processados: this.stats.processed,
            total: this.stats.total,
            atual: cliente.nome,
            status: coordenadas ? 'sucesso' : 'erro',
            coordenadas,
            lote: batchIndex + 1,
            totalLotes: totalBatches,
            stats: { ...this.stats }
          });
        }

        // Rate limiting
        await this.sleep(this.rateLimitDelay);
      }

      // Salva progresso do lote
      await this.saveProgress(Array.from(processedIds), batchIndex + 1);
      await this.saveCache();

      // Log do lote
      const sucessoLote = lote.filter(c => c.geocoded).length;
      console.log(`✅ Lote ${batchIndex + 1} concluído: ${sucessoLote}/${lote.length} sucessos`);
      
      // Pausa entre lotes (opcional)
      if (batchIndex < totalBatches - 1) {
        console.log(`⏳ Pausa de 2 segundos entre lotes...`);
        await this.sleep(2000);
      }
    }

    this.stats.endTime = new Date();
    const tempoTotal = (this.stats.endTime - this.stats.startTime) / 1000;
    
    console.log(`\n🎉 Geocodificação otimizada concluída!`);
    console.log(`⏱️  Tempo total: ${Math.round(tempoTotal)} segundos (${(tempoTotal/60).toFixed(1)} minutos)`);
    console.log(`📊 Estatísticas finais:`);
    console.log(`   Total: ${this.stats.total}`);
    console.log(`   Processados: ${this.stats.processed}`);
    console.log(`   Sucessos: ${this.stats.success}`);
    console.log(`   Erros: ${this.stats.errors}`);
    console.log(`   Cache hits: ${this.stats.cached}`);
    console.log(`   Taxa de sucesso: ${((this.stats.success / this.stats.processed) * 100).toFixed(1)}%`);

    // Salva cache final
    await this.saveCache();

    return clientes;
  }

  /**
   * Estima tempo de processamento
   */
  estimarTempo(quantidadeClientes, clientesJaProcessados = 0) {
    const pendentes = quantidadeClientes - clientesJaProcessados;
    const segundosPorItem = (this.rateLimitDelay + 500) / 1000; // Tempo médio por item
    const tempoEstimado = pendentes * segundosPorItem;
    
    return {
      pendentes,
      tempoSegundos: Math.round(tempoEstimado),
      tempoMinutos: Math.round(tempoEstimado / 60),
      tempoHoras: (tempoEstimado / 3600).toFixed(1)
    };
  }

  /**
   * Otimiza rate limiting baseado na performance
   */
  ajustarRateLimit() {
    const taxaErro = this.stats.processed > 0 ? this.stats.errors / this.stats.processed : 0;
    
    if (taxaErro > 0.1) { // Mais de 10% de erro
      this.rateLimitDelay = Math.min(this.rateLimitDelay + 200, 3000);
      console.log(`⚠️  Alta taxa de erro, aumentando delay para ${this.rateLimitDelay}ms`);
    } else if (taxaErro < 0.02 && this.rateLimitDelay > 800) { // Menos de 2% de erro
      this.rateLimitDelay = Math.max(this.rateLimitDelay - 100, 800);
      console.log(`⚡ Baixa taxa de erro, reduzindo delay para ${this.rateLimitDelay}ms`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gera relatório detalhado
   */
  gerarRelatorioDetalhado(clientes) {
    const total = clientes.length;
    const geocodificados = clientes.filter(c => c.geocoded && c.latitude && c.longitude).length;
    const naoGeocodificados = total - geocodificados;
    const cacheHits = clientes.filter(c => c.cached).length;
    
    return {
      resumo: {
        total,
        geocodificados,
        naoGeocodificados,
        taxaSucesso: `${((geocodificados / total) * 100).toFixed(1)}%`,
        cacheHits,
        tempoProcessamento: this.stats.endTime && this.stats.startTime ? 
          `${Math.round((this.stats.endTime - this.stats.startTime) / 1000)} segundos` : 'N/A'
      },
      estatisticas: this.stats,
      detalhes: {
        com_coordenadas: clientes.filter(c => c.latitude && c.longitude),
        sem_coordenadas: clientes.filter(c => !c.latitude || !c.longitude),
        com_cache: clientes.filter(c => c.cached),
        processados_hoje: clientes.filter(c => {
          if (!c.data_geocodificacao) return false;
          const hoje = new Date().toDateString();
          const dataProcessamento = new Date(c.data_geocodificacao).toDateString();
          return hoje === dataProcessamento;
        })
      }
    };
  }

  /**
   * Limpa arquivos de cache e progresso
   */
  async limparCache() {
    try {
      await fs.unlink(this.cacheFile);
      await fs.unlink(this.progressFile);
      this.memoryCache.clear();
      console.log('🧹 Cache e progresso limpos');
    } catch (error) {
      console.log('🧹 Nenhum cache para limpar');
    }
  }
}

module.exports = GeocodingServiceAdvanced;
