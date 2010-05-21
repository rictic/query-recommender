var sys = require('sys');
var fs = require('fs');

var options = process_cmdline(process.ARGV,{
  log:'../query.log',
});


function process_cmdline(args,defaults) {
  for (var i=2; i<args.length; i++) {
    var arg = args[i];
    var r = /--(.+)=(.+)/.exec(arg);
    if (!r || !r.length===2) { sys.puts('Invalid option '+arg); process.exit(1); }
    defaults[r[1]]=r[2]; // extend defaults with key,val
  }
  return defaults;
}


var f = fs.openSync(option.log,'r');
readFile(f)

function readFile(f) {
  fs.read(f, 4 * 1024, null, 'utf-8', function(_, data) {
    if (data && data.length > 0) {
      handleData(data);
      readFile(f)
    } else {
      onComplete();
    }
  })
}

var buffer = "";
function handleData(data) {
  buffer += data;
  var match;
  while(match = buffer.match(/(\d+)\t(.*?)\n/)) {
    handleRecord(parseInt(match[1], 10), match[2])
    buffer = buffer.substring(match.index+match[0].length);
  }
}

var all_posts = {};
function handleRecord(_, post) {
  all_posts[post] = (all_posts[post] || 0) + 1;
}

function onComplete() {
  var records = [];
  for (var post in all_posts)
    records.push([all_posts[post], post])
  records.sort(function(a,b) {
    if (a[0] === b[0]) {
      if (a[1] > b[1])
        return -1
      if (a[1] === b[1])
        return 0
      return 1
    }
    if (a[0] > b[0])
      return -1
    return 1
  })
  records = records.map(function(a){return a[1]})
  fs.writeFile("popular.json", JSON.stringify(records));
  records.forEach(function(query) {
    sys.puts(query);
  })
}