var net = require('net')
var sys = require('sys')

var client = net.createConnection(7000, 'popular.youropenbook.org')
client.addListener('data', handleData)


var buffer = "";
function handleData(data) {
  buffer += data;
  var match;
  while(match = buffer.match(/(\d+)\t(.*?)\n/)) {
    handleRecord(parseInt(match[1], 10), match[2])
    buffer = buffer.substring(match.index+match[0].length);
  }
}


var records = [];
var TIMEFRAME = 60; //in seconds
function handleRecord(timestamp, query) {
  sys.print("\r                         \r")
  sys.puts(query)
  records.unshift(timestamp);
  var recently = timestamp - TIMEFRAME * 1000;
  for (var i = records.length -1; ; i--) {
    if (records[i] >= recently)
      break
    records.pop();
  }
  var qps = records.length / TIMEFRAME;
  sys.print("qps: " + Math.round(qps * 100) / 100)
}