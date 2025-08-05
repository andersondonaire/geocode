const GeocodingService = require('./geocoding-service');
const fs = require('fs').promises;

async function testeSimples() {
  console.log('🧪 Iniciando teste do serviço de geocodificação...\n');
  
  const geocoding = new GeocodingService();
  
  // Teste com um endereço específico
  const endereco = 'Avenida Paulista, 1000, São Paulo, SP';
  console.log(`📍 Testando endereço: ${endereco}`);
  
  const resultado = await geocoding.buscarCoordenadas(endereco);
  
  if (resultado) {
    console.log('✅ Sucesso!');
    console.log(`   Latitude: ${resultado.latitude}`);
    console.log(`   Longitude: ${resultado.longitude}`);
    console.log(`   Endereço formatado: ${resultado.endereco_formatado}`);
    console.log(`   Confiança: ${resultado.confianca}`);
  } else {
    console.log('❌ Não foi possível geocodificar o endereço');
  }
  
  console.log('\n🔚 Teste concluído');
}

async function testeLote() {
  console.log('🧪 Iniciando teste de processamento em lote...\n');
  
  const geocoding = new GeocodingService();
  
  // Carrega dados do arquivo JSON
  const dados = await fs.readFile('./clientes.json', 'utf8');
  const clientes = JSON.parse(dados);
  
  console.log(`📊 Processando ${clientes.length} clientes...`);
  
  // Callback de progresso
  const onProgress = (progresso) => {
    console.log(`⏳ Progresso: ${progresso.processados}/${progresso.total} - ${progresso.atual} (${progresso.status})`);
  };
  
  // Processa apenas os primeiros 3 clientes para o teste
  const clientesTeste = clientes.slice(0, 3);
  
  const clientesProcessados = await geocoding.processarClientes(clientesTeste, onProgress);
  
  // Gera relatório
  const relatorio = geocoding.gerarRelatorio(clientesProcessados);
  
  console.log('\n📊 Relatório final:');
  console.log(`   Total: ${relatorio.total}`);
  console.log(`   Geocodificados: ${relatorio.geocodificados}`);
  console.log(`   Não geocodificados: ${relatorio.naoGeocodificados}`);
  console.log(`   Taxa de sucesso: ${relatorio.taxaSucesso}`);
  
  console.log('\n🔚 Teste de lote concluído');
}

// Executa os testes
async function executarTestes() {
  try {
    await testeSimples();
    console.log('\n' + '='.repeat(50) + '\n');
    await testeLote();
  } catch (error) {
    console.error('❌ Erro durante os testes:', error.message);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  executarTestes();
}

module.exports = { testeSimples, testeLote };
