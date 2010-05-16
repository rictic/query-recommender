var sys = require('sys');
var http = require('http');
var url = require('url');
var net = require('net');

//we lie for the first little bit while the server gets data
var latest = ["cheated test", "don't tell anyone", "rectal exam", "HIV test", "control urges", "lost virginity", "playing hooky"];;
// var most_popular = [];
var results = {
  latest: latest,
//   most_popular: most_popular
}
http.createServer(function (request, response) {
  var out = JSON.stringify(results);

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


function log_query(query) {
  //we only want unique examples
  if (latest.indexOf(query) === -1)
    latest.unshift(query);
  while (latest.length > 7)
    latest.pop();
  
  //broadcast:
  clients.forEach(function(client) {
    var was_sent = client.write(query + "\n");
  })
}

function removeElement(array, value) {
  var i = array.indexOf(value);
  return array.slice(0,i).concat(l.slice(i+i,l.length))
}

sys.puts('Server running');