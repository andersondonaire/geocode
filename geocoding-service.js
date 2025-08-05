const axios = require('axios');

class GeocodingService {
  constructor() {
    // Nominatim OpenStreetMap API - Gratuita e open source
    this.baseURL = 'https://nominatim.openstreetmap.org/search';
    this.rateLimitDelay = 1000; // 1 segundo entre requisições (política do Nominatim)
    this.userAgent = 'BuscaLatLon/1.0.0'; // User-Agent obrigatório
  }

  /**
   * Busca coordenadas de um endereço usando Nominatim OSM
   * @param {string} endereco - Endereço completo
   * @returns {Promise<Object>} - {latitude, longitude, endereco_formatado} ou null
   */
  async buscarCoordenadas(endereco) {
    try {
      console.log(`🔍 Buscando coordenadas para: ${endereco}`);
      
      const params = {
        q: `${endereco}, Brasil`, // Adiciona "Brasil" para melhor precisão
        format: 'json',
        addressdetails: 1,
        limit: 1,
        countrycodes: 'br' // Restringe busca ao Brasil
      };

      const headers = {
        'User-Agent': this.userAgent
      };

      const response = await axios.get(this.baseURL, {
        params,
        headers,
        timeout: 10000 // 10 segundos de timeout
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          endereco_formatado: result.display_name,
          confianca: result.importance || 0
        };
      }

      console.log(`❌ Nenhum resultado encontrado para: ${endereco}`);
      return null;

    } catch (error) {
      console.error(`❌ Erro ao buscar coordenadas para "${endereco}":`, error.message);
      return null;
    }
  }

  /**
   * Processa uma lista de clientes com geocodificação sequencial
   * @param {Array} clientes - Array de objetos cliente
   * @param {Function} onProgress - Callback de progresso
   * @returns {Promise<Array>} - Array de clientes com coordenadas
   */
  async processarClientes(clientes, onProgress = null) {
    const clientesProcessados = [];
    let processados = 0;
    const total = clientes.length;

    console.log(`📍 Iniciando geocodificação de ${total} clientes...`);

    for (const cliente of clientes) {
      // Verifica se já foi geocodificado
      if (cliente.geocoded && cliente.latitude && cliente.longitude) {
        console.log(`✅ Cliente ${cliente.nome} já possui coordenadas`);
        clientesProcessados.push(cliente);
        processados++;
        
        if (onProgress) {
          onProgress({
            processados,
            total,
            atual: cliente.nome,
            status: 'já_processado'
          });
        }
        continue;
      }

      // Busca coordenadas
      const coordenadas = await this.buscarCoordenadas(cliente.endereco);
      
      const clienteAtualizado = {
        ...cliente,
        latitude: coordenadas ? coordenadas.latitude : null,
        longitude: coordenadas ? coordenadas.longitude : null,
        endereco_formatado: coordenadas ? coordenadas.endereco_formatado : null,
        confianca: coordenadas ? coordenadas.confianca : null,
        geocoded: coordenadas !== null,
        data_geocodificacao: new Date().toISOString()
      };

      clientesProcessados.push(clienteAtualizado);
      processados++;

      const status = coordenadas ? 'sucesso' : 'erro';
      console.log(`${coordenadas ? '✅' : '❌'} Cliente ${cliente.nome}: ${status}`);

      if (onProgress) {
        onProgress({
          processados,
          total,
          atual: cliente.nome,
          status,
          coordenadas
        });
      }

      // Rate limiting - aguarda antes da próxima requisição
      if (processados < total) {
        console.log(`⏳ Aguardando ${this.rateLimitDelay}ms antes da próxima requisição...`);
        await this.sleep(this.rateLimitDelay);
      }
    }

    console.log(`🎉 Geocodificação concluída! ${processados}/${total} clientes processados`);
    return clientesProcessados;
  }

  /**
   * Utilitário para pausar execução
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gera relatório de geocodificação
   */
  gerarRelatorio(clientes) {
    const total = clientes.length;
    const geocodificados = clientes.filter(c => c.geocoded).length;
    const naoGeocodificados = total - geocodificados;
    const taxaSucesso = ((geocodificados / total) * 100).toFixed(1);

    return {
      total,
      geocodificados,
      naoGeocodificados,
      taxaSucesso: `${taxaSucesso}%`,
      detalhes: {
        com_coordenadas: clientes.filter(c => c.latitude && c.longitude),
        sem_coordenadas: clientes.filter(c => !c.latitude || !c.longitude)
      }
    };
  }
}

module.exports = GeocodingService;
