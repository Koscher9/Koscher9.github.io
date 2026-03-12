iconst fs = require('fs');
const js = fs.readFileSync('script.js', 'utf8');
// Create a fake DOM to test logic
const domCode = `
const document = {
    getElementById: (id) => ({ 
        id, 
        classList: { add: ()=>{}, remove: ()=>{}, contains: ()=>false },
        style: {},
        addEventListener: ()=>{},
        appendChild: ()=>{},
        children: Array(100).fill(0).map((_,i)=>({ classList: { add: ()=>{}, remove: ()=>{} }, dataset: {index: i} }))
    }),
    createElement: () => ({ classList: { add: ()=>{} }, dataset: {} }),
    addEventListener: ()=>{}
};
let window = { location: { search: '' } };
class URLSearchParams { constructor() { this.get = () => null; } }
class Peer { constructor() { this.on = ()=>{}; } }
const alert = console.log;
`;

const codeToRun = domCode + js.replace('init();', '') + `
try {
    init();
    
    // simulate setup
    gameStarted = true;
    gameMode = 'normal';
    myReady = true; opponentReady = true;
    isMyTurn = true;
    
    myBoard[10].isShip = true;
    myBoard[10].shipId = 0;
    
    // Simulate Host firing at Guest, it misses
    console.log("simulating attack click");
    let fakeEvent = { target: { dataset: { index: "11" } } };
    handleAttackClick(fakeEvent);
    
    // simulate response
    console.log("simulating receiveShotResult");
    receiveShotResult(11, false, false, [], false, null);
    
    // Simulate opponent firing at us
    console.log("simulating opponent shot (handleIncomingShot)");
    handleIncomingShot(10);
    
    console.log("No crash!");
} catch(e) {
    console.error("CRASH:", e);
}
`;
fs.writeFileSync('test.js', codeToRun);
