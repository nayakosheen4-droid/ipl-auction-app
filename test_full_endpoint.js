const ExcelJS = require('exceljs');
const path = require('path');

async function testEndpoint() {
  try {
    // Use the test file we just created
    const testPath = path.join(__dirname, 'data', 'test_auction.xlsx');
    
    console.log('📖 Reading workbook...');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(testPath);
    
    const playersSheet = workbook.getWorksheet('Available Players');
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    console.log('\n📊 Sheets found:');
    console.log('  Available Players:', playersSheet ? 'EXISTS' : 'MISSING');
    console.log('  Sold Players:', soldSheet ? 'EXISTS' : 'MISSING');
    
    if (!playersSheet) {
      console.log('\n⚠️  Available Players sheet missing - this would cause HTTP 500!');
      console.log('Creating dummy Players sheet for test...');
      
      const newPlayersSheet = workbook.addWorksheet('Available Players');
      newPlayersSheet.columns = [
        { header: 'Player ID', key: 'id', width: 10 },
        { header: 'Player Name', key: 'name', width: 30 },
        { header: 'Position', key: 'position', width: 20 },
        { header: 'Franchise', key: 'franchise', width: 20 },
        { header: 'Base Price', key: 'basePrice', width: 15 },
        { header: 'Overseas', key: 'overseas', width: 10 }
      ];
      
      // Add the players from sold sheet
      newPlayersSheet.addRow([3, 'Jasprit Bumrah', 'Bowler', '', 2, false]);
      newPlayersSheet.addRow([70, 'Travis Head', 'Batsman', '', 2, true]);
      
      await workbook.xlsx.writeFile(testPath);
      console.log('✅ Added Players sheet');
      
      // Re-read
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.readFile(testPath);
      const ps = wb2.getWorksheet('Available Players');
      const ss = wb2.getWorksheet('Sold Players');
      
      testSoldPlayersEndpoint(ps, ss);
    } else {
      testSoldPlayersEndpoint(playersSheet, soldSheet);
    }
    
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
  }
}

function testSoldPlayersEndpoint(playersSheet, soldSheet) {
  console.log('\n🧪 Testing /api/players/sold endpoint logic...\n');
  
  // Build overseas map
  const overseasMap = new Map();
  playersSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const playerId = row.getCell(1).value;
      const isOverseas = row.getCell(6).value === true || row.getCell(6).value === 'true';
      overseasMap.set(playerId, isOverseas);
      console.log(`  OverseasMap: Player ${playerId} → ${isOverseas}`);
    }
  });
  
  console.log(`\n📊 Built overseasMap with ${overseasMap.size} entries`);
  
  // Get all sold players
  const soldPlayers = [];
  let rowCount = 0;
  soldSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      rowCount++;
      
      console.log(`\n📋 Sold Players Row ${rowNumber}:`, {
        cell1: row.getCell(1).value,
        cell2: row.getCell(2).value,
        cell3: row.getCell(3).value,
        cell4: row.getCell(4).value,
        cell5: row.getCell(5).value,
        cell6: row.getCell(6).value,
        cell7: row.getCell(7).value
      });
      
      const playerId = row.getCell(1).value;
      const playerName = row.getCell(2).value;
      const position = row.getCell(3).value;
      const teamId = row.getCell(4).value;
      const teamName = row.getCell(5).value;
      const finalPrice = row.getCell(6).value;
      const rtmUsed = row.getCell(7).value === 'Yes';
      const isOverseas = overseasMap.get(playerId) || false;
      
      if (playerName && teamName && finalPrice) {
        soldPlayers.push({
          playerId,
          playerName,
          position,
          teamId,
          teamName,
          finalPrice,
          rtmUsed,
          overseas: isOverseas
        });
        console.log(`  ✅ Added: ${playerName} → ${teamName} (₹${finalPrice} Cr, Overseas: ${isOverseas})`);
      } else {
        console.warn(`  ⚠️  Row ${rowNumber} missing data: playerName=${playerName}, teamName=${teamName}, price=${finalPrice}`);
      }
    }
  });
  
  console.log(`\n✅ SUCCESS: Fetched ${soldPlayers.length} sold players`);
  console.log(JSON.stringify(soldPlayers, null, 2));
}

testEndpoint();
