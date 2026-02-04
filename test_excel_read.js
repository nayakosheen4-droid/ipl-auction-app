const ExcelJS = require('exceljs');
const path = require('path');

async function testRead() {
  // Create a test workbook matching the structure
  const workbook = new ExcelJS.Workbook();
  const soldSheet = workbook.addWorksheet('Sold Players');
  
  // Set up columns exactly as in server
  soldSheet.columns = [
    { header: 'Player ID', key: 'playerId', width: 10 },
    { header: 'Player Name', key: 'playerName', width: 30 },
    { header: 'Position', key: 'position', width: 20 },
    { header: 'Team ID', key: 'teamId', width: 10 },
    { header: 'Team Name', key: 'teamName', width: 30 },
    { header: 'Final Price', key: 'finalPrice', width: 15 },
    { header: 'RTM Used', key: 'rtmUsed', width: 10 }
  ];
  
  // Add data matching the screenshot
  soldSheet.addRow([3, 'Jasprit Bumrah', 'Bowler', 9, 'Gujarat Titans', 23.5, 'No']);
  soldSheet.addRow([70, 'Travis Head', 'Batsman', 8, 'Sunrisers Hyderabad', 23.5, 'Yes']);
  
  // Save it
  const testPath = path.join(__dirname, 'data', 'test_auction.xlsx');
  await workbook.xlsx.writeFile(testPath);
  console.log('✅ Created test file:', testPath);
  
  // Now read it back
  const readWorkbook = new ExcelJS.Workbook();
  await readWorkbook.xlsx.readFile(testPath);
  const readSheet = readWorkbook.getWorksheet('Sold Players');
  
  console.log('\n📖 Reading back the data:');
  console.log('Sheet name:', readSheet.name);
  console.log('Row count:', readSheet.rowCount);
  console.log('');
  
  readSheet.eachRow((row, rowNumber) => {
    console.log(`\n📋 Row ${rowNumber} (rowNumber > 1 = ${rowNumber > 1}):`);
    for (let i = 1; i <= 7; i++) {
      const value = row.getCell(i).value;
      console.log(`  Cell ${i}: ${JSON.stringify(value)} (type: ${typeof value})`);
    }
    
    if (rowNumber > 1) {
      const playerId = row.getCell(1).value;
      const playerName = row.getCell(2).value;
      const position = row.getCell(3).value;
      const teamId = row.getCell(4).value;
      const teamName = row.getCell(5).value;
      const finalPrice = row.getCell(6).value;
      const rtmUsed = row.getCell(7).value;
      
      console.log('\n  🔍 Parsed values:');
      console.log(`    playerId: ${playerId}`);
      console.log(`    playerName: ${playerName}`);
      console.log(`    position: ${position}`);
      console.log(`    teamId: ${teamId} (type: ${typeof teamId})`);
      console.log(`    teamName: ${teamName}`);
      console.log(`    finalPrice: ${finalPrice}`);
      console.log(`    rtmUsed: ${rtmUsed}`);
      
      // Test comparison for team 8 (Sunrisers)
      const requestedTeamId = 8;
      const rowTeamIdNum = typeof teamId === 'number' ? teamId : parseInt(teamId);
      const teamIdNum = typeof requestedTeamId === 'number' ? requestedTeamId : parseInt(requestedTeamId);
      const match = rowTeamIdNum === teamIdNum;
      
      console.log(`\n  ✅ Team 8 comparison: ${rowTeamIdNum} === ${teamIdNum} = ${match}`);
    }
  });
}

testRead().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
});
