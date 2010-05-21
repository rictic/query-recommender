// this is just a dump of code the should be re-integrated

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


function broadcast(message) {
  clients.forEach(function(client) {
    try {
      //race condition here, but the error is uncatchable,
      //this is the best I can figure to do
      if (client.readyState === "open") {
        client.write(message);
      }
    } catch(e) {
      sys.puts("error writing to client");
      sys.puts(e.stack || e.message);
    }
  });
}

function removeElement(array, value) {
  var i = array.indexOf(value);
  if (i === -1) {
    return array;
  }
  return array.slice(0,i).concat(array.slice(i+i,array.length));
}

// this could be useful?
var visits = 459634;
var mins_per_visit = 3 + 51/60;

var mins_total = visits * mins_per_visit;
var hours_total = mins_total/60;
var days_total = hours_total/24;
var years_total = days_total/365.25;

years_total

 