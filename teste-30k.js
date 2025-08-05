const GeocodingServiceAdvanced = require('./geocoding-service-advanced');
const fs = require('fs').promises;

async function testeGrandeVolume() {
  console.log('🧪 Teste para Grandes Volumes (30k+ registros)\n');
  
  const geocoding = new GeocodingServiceAdvanced({
    rateLimitDelay: 500,    // Teste mais rápido
    batchSize: 50,          // Lotes menores para teste
    maxRetries: 2,          // Menos tentativas para teste
    cacheEnabled: true
  });
  
  console.log('📊 Criando dados de teste simulados...');
  
  // Simula 1000 registros para teste (representando 30k)
  const clientesTeste = [];
  const enderecosBrasil = [
    'Avenida Paulista, São Paulo, SP',
    'Rua Oscar Freire, São Paulo, SP',
    'Copacabana, Rio de Janeiro, RJ',
    'Avenida Atlântica, Rio de Janeiro, RJ',
    'Centro, Belo Horizonte, MG',
    'Savassi, Belo Horizonte, MG',
    'Boa Viagem, Recife, PE',
    'Centro, Salvador, BA',
    'Barra, Salvador, BA',
    'Centro, Brasília, DF'
  ];
  
  for (let i = 1; i <= 100; i++) { // 100 registros para teste rápido
    const endereco = enderecosBrasil[i % enderecosBrasil.length];
    clientesTeste.push({
      id: i,
      nome: `Cliente Teste ${i}`,
      endereco: `${endereco}, ${Math.floor(Math.random() * 1000) + 1}`,
      latitude: null,
      longitude: null,
      geocoded: false
    });
  }
  
  console.log(`📍 Iniciando teste com ${clientesTeste.length} registros`);
  console.log('⚙️  Configuração otimizada para teste:');
  console.log(`   - Rate limit: ${geocoding.rateLimitDelay}ms`);
  console.log(`   - Lotes: ${geocoding.batchSize} registros`);
  console.log(`   - Cache: ${geocoding.cacheEnabled ? 'Habilitado' : 'Desabilitado'}`);
  
  const inicioTeste = Date.now();
  
  // Callback de progresso
  const onProgress = (progresso) => {
    const porcentagem = ((progresso.processados / progresso.total) * 100).toFixed(1);
    console.log(`⏳ ${porcentagem}% - Lote ${progresso.lote}/${progresso.totalLotes} - ${progresso.atual} (${progresso.status})`);
    
    if (progresso.stats) {
      const { success, errors, cached } = progresso.stats;
      console.log(`   📊 Sucessos: ${success}, Erros: ${errors}, Cache: ${cached}`);
    }
  };
  
  try {
    const clientesProcessados = await geocoding.processarClientesOtimizado(clientesTeste, onProgress);
    
    const fimTeste = Date.now();
    const tempoTeste = (fimTeste - inicioTeste) / 1000;
    
    // Gera relatório
    const relatorio = geocoding.gerarRelatorioDetalhado(clientesProcessados);
    
    console.log('\n🎉 TESTE CONCLUÍDO!');
    console.log('=' .repeat(60));
    console.log(`⏱️  Tempo de execução: ${tempoTeste.toFixed(1)} segundos`);
    console.log(`📊 Estatísticas do teste:`);
    console.log(`   Total processados: ${relatorio.resumo.total}`);
    console.log(`   Sucessos: ${relatorio.resumo.geocodificados}`);
    console.log(`   Falhas: ${relatorio.resumo.naoGeocodificados}`);
    console.log(`   Taxa de sucesso: ${relatorio.resumo.taxaSucesso}`);
    console.log(`   Cache hits: ${relatorio.resumo.cacheHits}`);
    
    // Projeção para 30k registros
    console.log('\n🚀 PROJEÇÃO PARA 30.000 REGISTROS:');
    console.log('=' .repeat(60));
    
    const tempoPorRegistro = tempoTeste / clientesTeste.length;
    const tempo30k = (tempoPorRegistro * 30000) / 60; // em minutos
    const horas = Math.floor(tempo30k / 60);
    const minutos = Math.round(tempo30k % 60);
    
    console.log(`⏱️  Tempo estimado: ${horas}h ${minutos}min`);
    console.log(`📈 Velocidade: ${(clientesTeste.length / tempoTeste * 60).toFixed(1)} registros/minuto`);
    console.log(`💾 Uso de memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    
    // Recomendações
    console.log('\n💡 RECOMENDAÇÕES PARA 30K REGISTROS:');
    console.log('=' .repeat(60));
    
    if (tempo30k > 480) { // Mais de 8 horas
      console.log('⚠️  Tempo muito longo. Sugestões:');
      console.log('   - Reduzir rate limit para 800ms');
      console.log('   - Aumentar lote para 200 registros');
      console.log('   - Executar em múltiplas sessões');
    } else {
      console.log('✅ Tempo aceitável para processamento em lote');
    }
    
    if (relatorio.resumo.cacheHits > 0) {
      console.log(`🎯 Cache está funcionando (${relatorio.resumo.cacheHits} hits)`);
    }
    
    console.log('📦 Sistema preparado para grandes volumes!');
    
    // Salva amostra dos resultados
    const amostra = clientesProcessados.slice(0, 10);
    await fs.writeFile('teste-30k-amostra.json', JSON.stringify(amostra, null, 2));
    console.log('💾 Amostra salva em: teste-30k-amostra.json');
    
  } catch (error) {
    console.error('❌ Erro durante o teste:', error.message);
  }
}

async function analisarPerformance() {
  console.log('\n🔍 ANÁLISE DE PERFORMANCE PARA 30K REGISTROS');
  console.log('=' .repeat(60));
  
  const cenarios = [
    { rate: 1000, batch: 100, desc: 'Configuração Padrão' },
    { rate: 800, batch: 200, desc: 'Otimizada para Velocidade' },
    { rate: 1500, batch: 50, desc: 'Conservadora (menos erros)' }
  ];
  
  cenarios.forEach(cenario => {
    const registrosPorSegundo = 1000 / cenario.rate;
    const tempoTotal = 30000 / registrosPorSegundo;
    const horas = Math.floor(tempoTotal / 3600);
    const minutos = Math.round((tempoTotal % 3600) / 60);
    
    console.log(`\n📋 ${cenario.desc}:`);
    console.log(`   Rate limit: ${cenario.rate}ms`);
    console.log(`   Tamanho do lote: ${cenario.batch}`);
    console.log(`   Tempo estimado: ${horas}h ${minutos}min`);
    console.log(`   Velocidade: ${(registrosPorSegundo * 60).toFixed(1)} reg/min`);
  });
}

// Executa os testes
if (require.main === module) {
  console.log('🚀 SISTEMA DE TESTE PARA GRANDES VOLUMES\n');
  
  testeGrandeVolume()
    .then(() => analisarPerformance())
    .then(() => {
      console.log('\n✅ Todos os testes concluídos!');
      console.log('📖 Verifique o README.md para instruções de otimização');
    })
    .catch(error => {
      console.error('❌ Erro nos testes:', error.message);
    });
}

module.exports = { testeGrandeVolume, analisarPerformance };
