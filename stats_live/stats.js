var net = require('net')
var sys = require('sys')
var languageParser = require("../language")

var TIMEFRAME = 60; //in seconds

var client;
function createClient() {
  client = net.createConnection(7000, process.argv[2] || 'popular.youropenbook.org')
  client.addListener('data', handleData)
  
  //connection maintenance
  sys.puts('connecting...')
  var connected = false;
  client.addListener("connect", function() {
    connected = true;
    sys.puts("connected");
  })
  client.addListener("error", restart)
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

function handleRecord(record) {
  switch(record.kind){
    case "query":
      if ((""+record.q).trim() !== "")
        println(record.q);
      updateQPS(record.t)
      break;
    case "share":
      println(em(record.q));
      break;
    case "internal error":
      error(record.stack || record.error)
      break;
    default: 
      return;//boring
  }
}

var records = [];
function updateQPS(t) {
  records.unshift(t);
  var recently = t - TIMEFRAME * 1000;
  for (var i = records.length -1; ; i--) {
    if (records[i] >= recently)
      break
    records.pop();
  }
  var qps = records.length / TIMEFRAME;
  updateTicker("qps: " + Math.round(qps * 100) / 100)
}


var eraseLine = false;
var ticker;
function erase() {
  if (eraseLine) {
    sys.print("\r                         \r")
    eraseLine = false;
  }
}
function print(msg) {
  erase();
  sys.print(msg);
}
function println(msg) {
  erase();
  print(msg + "\n");
  if (ticker) {
    sys.print(ticker)
    eraseLine = true;
  }
}

function updateTicker(msg) {
  erase();
  print(msg);
  ticker = msg;
  eraseLine = true;
}

//silly terminal code stuff
function error(msg) {
  println(horrifying("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"))
  println(msg)
  println(horrifying("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"))
}

function em(s) {
  return controlCode([1,4], s);
}

function horrifying(s) {
  return controlCode([31,5], s)
}

function controlCode(codes, s) {
  var result = "";
  if (codes.forEach){
    codes.forEach(function(c) {result += code(c)})
  }
  else {
    result += code(codes);
  }
  return result + s + code(0);
}
function code(c) {return "\u001b["+c+"m"};
