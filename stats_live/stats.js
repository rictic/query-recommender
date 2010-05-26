var net = require('net')
var sys = require('sys')

var client;
function createClient() {
  sys.puts('connecting...')
  client = net.createConnection(7000, process.argv[2] || 'popular.youropenbook.org')
  var connected = false;
  client.addListener("connect", function() {
    connected = true;
    sys.puts("connected");
  })
  client.addListener("error", restart)
  client.addListener('data', handleData)
  client.addListener("close", restart)
  client.addListener("end", restart)
  var restarted = false;
  function restart() {
    if (!restarted) {
      if (connected)
        sys.puts("connection lost")
      setTimeout(createClient, 3000);
    }
      
    restarted = true;
  }
}
createClient()

var buffer = "";
function handleData(data) {
  buffer += data;
  var match;
  while(match = buffer.match(/^(.*?)\n/)) {
    var data = match[1];
    if (data.trim() !== "")
      handleRecord(JSON.parse(data))
    buffer = buffer.substring(match.index+match[0].length);
  }
}


var records = [];
var TIMEFRAME = 60; //in seconds
function handleRecord(record) {
  var q = record.q || record.kind.q;
  if (!q) return;
  sys.print("\r                         \r")
  sys.puts(q);
  records.unshift(record.t);
  var recently = record.t - TIMEFRAME * 1000;
  for (var i = records.length -1; ; i--) {
    if (records[i] >= recently)
      break
    records.pop();
  }
  var qps = records.length / TIMEFRAME;
  sys.print("qps: " + Math.round(qps * 100) / 100)
}