var sys = require('sys');
var http = require('http');
var url = require('url');
var net = require('net');
var fs = require('fs');

var results = {
  latest: ["cheated test", "don't tell anyone", "rectal exam", "HIV test", "control urges", "lost virginity", "playing hooky"]
}

try {
  results = JSON.parse(fs.readFileSync("saved.json"))
} catch(e) {}

var latest = results.latest;

var output;
makeOutput();

http.createServer(function (request, response) {
  var out = output;
  var parts; 
  try {
    parts = url.parse(request.url, true)
  }catch(e) {}
  
  if (parts && parts.query && parts.query.q)
    log_query(parts.query.q);
  
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

var log_file = fs.openSync('query.log', 'a+')
function log_query(query) {
  //we only want unique examples
  if (latest.indexOf(query) === -1)
    latest.unshift(query);
  while (latest.length > 7)
    latest.pop();
  
  //log the message, both locally and over the network
  var message = (new Date().valueOf().toString()) + "\t" + query + "\n";
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
  output = JSON.stringify(results);
}

setInterval(makeOutput, 1000);

setInterval(function() {
  fs.writeFile('saved.json', output)
}, 30 * 1000)