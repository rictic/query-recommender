var sys = require('sys');
var http = require('http');
var url = require('url');
var net = require('net');
var fs = require('fs');

var results = {
  latest: ["cheated test", "don't tell anyone", "rectal exam", "HIV test", "control urges", "lost virginity", "playing hooky"],
  qpm : 0
}

try {
  var parsed = JSON.parse(fs.readFileSync("saved.json"))
  if (parsed && parsed.latest)
    results = parsed
} catch(e) {}

var latest = results.latest;

var stats = (function() {
  var records = [];
  var TIMEFRAME = 60*1000;
  function update(timestamp) {
    records.unshift(timestamp);
    var recently = timestamp - TIMEFRAME;
    for (var i = records.length -1; ; i--) {
      if (records[i] >= recently) { break; }
      records.pop();
    }
  }
  function getCount() { return records.length; } 
  return { update:update, getCount:getCount};
})();


var output;
makeOutput();

http.createServer(function (request, response) {
  var out = output;
  var parts, query;
  try {
    parts = url.parse(request.url, true)
    query = parts.query;
  }catch(e) {}
  
  if (query) {
    if (query.share) {
      sys.puts('Share: '+query.share);
    }
    if (query.q) {
      log_query(query.q);
    }
  }
  
  var callback;
  if (parts && parts.query && parts.query.callback)
    callback = parts.query.callback;
  
  response.writeHead(200, {'Content-Type': callback ? 'application/javascript' : 'application/json'});
  if (callback)
    out = callback + "(" + out + ")";
  response.end(out);
}).listen(8000, '0.0.0.0');


var clients = [];
net.createServer(function (stream) {
  stream.setEncoding('utf8');
  stream.addListener('connect', function () {
    clients.push(stream);
  });
  stream.addListener('close', function () {
    clients = removeElement(clients, stream);
  });
}).listen(7000, '0.0.0.0');

var spamFilter = /anonboard/
var log_file = fs.openSync('query.log', 'a+')
function log_query(query) {
  if (query.match(spamFilter))
    return;
  var timestamp = +new Date();
  stats.update(timestamp);
  
  //we only want unique examples
  if (latest.indexOf(query) === -1)
    latest.unshift(query);
  while (latest.length > 7)
    latest.pop();
  
  //log the message, both locally and over the network
  var message = timestamp + "\t" + query + "\n";
  fs.write(log_file, message, null, 'utf-8');
  broadcast(message);
}

function broadcast(message) {
  clients.forEach(function(client) {
    try {
      //race condition here, but the error is uncatchable,
      //this is the best I can figure to do
      if (client.readyState === "open")
        client.write(message);
    } catch(e) {
      sys.puts("error writing to client");
      sys.puts(e.stack || e.message);
    }
  })
}

function removeElement(array, value) {
  var i = array.indexOf(value);
  if (i === -1)
    return array;
  return array.slice(0,i).concat(l.slice(i+i,l.length))
}

sys.puts('Server running');

function makeOutput() {
  results.qpm = stats.getCount();
  output = JSON.stringify(results);
}

setInterval(makeOutput, 1000);

setInterval(function() {
  fs.writeFile('saved.json', output)
}, 30 * 1000)