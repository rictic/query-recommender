var sys  = require('sys');
var http = require('http');
var url  = require('url');
var net  = require('net');
var fs   = require('fs');
var parseLanguage = require("./language").parseLanguage

var LOG_SERVER_PORT = 8000;    // for /latest?q=xxx&gender=any and /share?q=xxx&gender=any&count=11&userid=1058420149
var BROADCASTER_PORT = 7000;   // for realtime stats
var QUERY_LOG  = 'query.log';  // every query run on our site
var SHARE_LOG  = 'share.log';  // every query that's a candidate for recent searches
var STATE_FILE = 'saved.json'; // persisted server state
var BLACK_FILE = 'blacklist.txt';  // list of forbidden words
var io = require("./lib/socket.io/socket.io")


// invoke with node server.js -debug=3 for max console logging
var DEBUG=(function(arg) {
  var r = /-debug=?(\d+)?/.exec(arg);
  if (r && r.length===2) { return parseInt(r[1],10); }
  return 0;
}
)(process.argv[2]||'');

if (DEBUG) { sys.puts('\n\nInit. Debug level='+DEBUG); }

//////////////////////
// maintain the qpm //
//////////////////////
var stats = (function() {
  var records = [];
  var TIMEFRAME = 60*1000;
  function update(update_only) {
    var timestamp = +new Date();
    if (!update_only) { records.unshift(timestamp); }
    var recently = timestamp - TIMEFRAME;
    for (var i = records.length -1; i>=0; i--) {
      if (records[i] >= recently) { break; }
      records.pop();
    }
  }
  function getCount() { return records.length; }
  return { update:update, getCount:getCount};
}
)();

////////////////////////////
// maintain the query log //
////////////////////////////
var query_logger = (function(stat_logger) {
  var log_file = fs.openSync(QUERY_LOG, 'a+');

  function log(query) {
    var timestamp = +new Date();
    stat_logger.update();
    broadcaster.broadcast("query", {t:timestamp, q:query.q, l:query.lang, v:query.v} );
    var message = [timestamp, query.q, query.lang, query.v, query.ref].join('\t') + "\n";
    if (DEBUG>2) { sys.print(QUERY_LOG + ': '+message); }
    fs.write(log_file, message, null, 'utf-8');
  }
  return {log:log};
}
)(stats);

/////////////////////////////
// maintain the shares log //
/////////////////////////////
var share_logger = (function() {
  var share_file = fs.openSync(SHARE_LOG, 'a+');
  function log(query) {
    var timestamp = +new Date();
    broadcaster.broadcast("share", { t: timestamp, q: query.q, l: query.lang, g: query.gender, c: query.count, u: query.userid });
    var message = [timestamp, query.q, query.lang, query.gender, query.count, query.userid, query.v].join('\t') + '\n';
    if (DEBUG>1) { sys.print(SHARE_LOG + ': '+message); }
    fs.write(share_file, message, null, 'utf-8' );
  }
  return {log:log};
}
)();


///////////////
// Blacklist //     TODO:  make language specific
///////////////
var blacklist = (function() {
  var forbidden_re = load_from_disk();

  // check blacklist every 3s for changes
  fs.watchFile(BLACK_FILE, {interval:3*1000}, function (curr, prev) {
    if ( +curr.mtime !== +prev.mtime) {
      forbidden_re = load_from_disk();
    }
  });

  function load_from_disk() {
    sys.puts('Blacklist: updating from '+BLACK_FILE);
    var list = ['fuck','cock','wank'];
    try {
      list = fs.readFileSync(BLACK_FILE, 'utf8').split('\n');
    } catch (e) {
      sys.puts('Blacklist error: '+e);
    }
    // ignore #comment lines and empty lines
    var re_str = '\\b(?:' + list.filter(function(line) { return line.length && line.indexOf('#')!==0;}).sort().join('|') + ')\\b';
    var re = new RegExp(re_str,'i');
    if (DEBUG) { sys.puts('Blacklist: '+sys.inspect(re)); }
    return re;
  }

  function contains(str) {
    if (!str || typeof str !=='string') { return true; } // ignore non-strings
    var forbidden = str.match(forbidden_re);
    if (forbidden && DEBUG>2) { sys.puts('Blacklist: matched: '+str); }
    return forbidden;
  }
  function filterlist(list) {
    return list.filter(function(str) { return !contains(str); });
  }
  return {contains:contains, filterlist:filterlist};
}
)();


////////////////////////////////
// Maintain the latest shares //
////////////////////////////////
var shares = (function(stat_logger) {
  var MAX_AGE    = 2 * 1000; // regenerate results if older than this
  var MAX_EXAMPLES = 20;     // number of search terms to return per language
  var results = unpersist() || {
    lang : {
      'en-us': new_lang()
    }
  };

  if (DEBUG>1) { sys.puts('Restored state: '+JSON.stringify(results,null,2)); }

  function new_lang() {
    return {
      latest: ["cheated test", "don't tell anyone", "rectal exam", "HIV test", "control urges", "lost virginity", "playing hooky"],
      lastupdate: 0, // timestamp when output was last updated
      output:     '' // JSON string to return for /latest
    };
  }

  // don't bother to send language results if they haven't changed since lastdump
  function dump(lastdump) {
    lastdump = lastdump || 0;
    var out = [];
    stat_logger.update(true); // update_only
    out.push('"timestamp":' + +new Date());
    out.push('"qpm":'       + stat_logger.getCount());
    for (var lcode in results.lang) {
      var lang_result = results.lang[lcode];
      var output = lang_result.output;
      if (output && lang_result.lastupdate > lastdump) {
        out.push( JSON.stringify(lcode) + ':' + output );
      }
    }
    out = '{' + out.join(',') + '}';
    lastdump = +new Date();
    return out;
  }
  // note: we don't persist qpm, that would require persisting the timestamp array which doesn't seem worth it
  function persist() {
    var out = JSON.stringify(results);
    if (DEBUG>1) { sys.puts(STATE_FILE+': '+out); }
    fs.writeFile(STATE_FILE, out);
  }
  function unpersist() {
    var state;
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
      // check it's a valid results object
      if (!state.lang) { return null; }
      for (var lcode in state.lang) {
        var lang_result = state.lang[lcode];
        lang_result.latest = blacklist.filterlist(lang_result.latest);
        update_output(lang_result,+new Date()); // make sure output reflects any new filtering
      }
    } catch(e) {
      sys.puts('unpersist failure: '+e);
    }
    return state;
  }

  function get_lang(lang) {
    if (!(lang in results.lang)) {
      if (DEBUG) { sys.puts('Added lang: '+lang); }
      results.lang[lang] = new_lang();
    }
    return results.lang[lang];
  }

  // takes query: {q:'my dui',lang:'en-us',gender:'any',count:22,userid:1282899202} //TODO: handle the other args
  function add(query) {
    var q = query.q;
    if (blacklist.contains(q)) { return; }
    var latest = get_lang(query.lang).latest;
    if (latest.indexOf(q) === -1) {          // we only want unique examples
      latest.unshift(q);
      while (latest.length > MAX_EXAMPLES) { // limit the number of examples
        latest.pop();
      }
      update_lang_results(query.lang);
    }
  }

  function update_output(lang_result, timestamp) {
    lang_result.lastupdate = timestamp;
    lang_result.output = JSON.stringify( lang_result.latest );
  }
  function update_lang_results(lang) {
    var lang_result = get_lang(lang);
    var timestamp = +new Date();
    var min_timestamp = timestamp - MAX_AGE;
    if (lang_result.lastupdate < min_timestamp) {
      update_output(lang_result,timestamp);
    }
  }

  function get_results(lang) {
    var lang_result = get_lang(lang);
    // it's possible to request latest before appending during startup
    if (!lang_result.output) {
      update_lang_results(lang);
    }
    return '{"qpm":'+stat_logger.getCount() + ', "latest":' + lang_result.output + '}';
  }

  setInterval(persist, 30 * 1000);
  return {get_results:get_results, add:add, dump:dump};
}
)(stats);

//////////////////
// server stats //
//////////////////
var server_stats = (function(qstats) {
  var s = {
    uptime: {
      init: new Date().toLocaleString(),
      t0:   +new Date(),
      hour:0, min:0, sec:0
    },
    mem: null,       // nodejs mem usage
    reqs: {          // request counters
      total:0, share:0, latest:0, old:0, dump:0, stats:0, invalid:0
    }
  };
  function increment(request_type) {
    s.reqs[request_type]++;
  }
  function div(num,d,decimals) { // divde and return with x decimal places
    var scale = Math.pow(10,decimals||0);
    return Math.floor(scale*num/d)/scale;
  }
  function get() {
    s.qpm = qstats.getCount();
    var up = div(+new Date() - s.uptime.t0 , 1000);
    s.uptime.sec  = up % 60;
    s.uptime.min  = div(up,60) % 60;
    s.uptime.hour = div(up,(60*60));
    //disabled: s.mem = process.memoryUsage();
    //disabled: for (var p in s.mem) { s.mem[p] = div(s.mem[p],(1024*1024), 1); } // convert to mb
    return s;
  }
  return {get:get,increment:increment};
  })(stats);

  /////////////////
  // log server  //
  /////////////////
var http_server = (function(share_logger,shares,query_logger,s) {
    function share(query) {
      s.increment('share');
      share_logger.log(query);
      shares.add(query);
      return '"SHARED"'; // dummy string
    }
    function latest(query) {
      s.increment('latest');
      query_logger.log(query);
      return shares.get_results(query.lang);
    }
    function old(query) {
      s.increment('old');
      if (query.q) {
        if (DEBUG) { sys.puts('Got old style log '+query.q); }
        return latest(query);
      }
      else if (query.share) {
        if (DEBUG) { sys.puts('Ignore old style share: '+query.share); }
        return '"IGNORED SHARE"';
      }
      else  {
        sys.puts('Invalid url');
        return '"IGNORED"';
      }
    }
    function dumps(query) {
      s.increment('dump');
      return shares.dump(query.lastdump);
    }
    function stats(query) {
      s.increment('stats');
      return JSON.stringify(s.get(),null,2);
    }
    function reqToString(request) {
      return 'remoteAddress:'+request.socket.remoteAddress +
      ' referrer:'  + (request.headers['referer']   ||'??') + 
      ' user-agent:'+ (request.headers['user-agent']||'??');
    }
    function invalid(request) {
      s.increment('invalid');
      sys.puts('Invalid url: '+request.url+'  from  '+reqToString(request));
      broadcaster.broadcast("invalid url", {url: request.url, request_string: reqToString(request)});
    }
    function internal_error(request, e) {
      broadcaster.broadcast("internal error", {url: request.url, message: e.message, stack: e.stack, request_string: reqToString(request)});
      sys.puts("INTERNAL ERROR: " + e.stack || e.message);
    }
    function get_lang_from_header(override,headers) {
      var lang = '??', accept;
      if (override) { accept = override; }
      else if ('accept-language' in headers) {
      accept  = parseLanguage(headers['accept-language'].toLowerCase()).code;
      } else {
        //  Firefox sometimes doesn't send accept-language
        if (DEBUG>2) { sys.puts('accept-language not in headers: '+sys.inspect(headers)); }
      }
      if (accept) {
        var bits = accept.split(/,|;/);
        if (bits.length && (/^\w+(-\w+)?$/.test(bits[0]))) {
          lang = bits[0];
        } else {
          if (DEBUG) { sys.puts('accept-language could not parse: '+accept); }
        }
      }
      return lang;
    }
    
    function respond(response,code,msg) {
      var headers = {
        'Content-Type'  : 'text/javascript; charset=UTF-8',
        'Cache-Control' : 'no-cache, must-revalidate',
        'Pragma'        : 'no-cache'
      };
      response.writeHead(code,headers);
      response.end(msg);
    }
  var http_server = http.createServer(function (request, response) {
      s.increment('total');
      var error;
      var output;
      if (DEBUG>3) { sys.puts('request: '+reqToString(request)); }
      var our_site = /^http:\/\/(([a-zA-Z_\.]*?)\.)?youropenbook.org/;
      if (request.headers.referer && !our_site.test(request.headers.referer)) {
        broadcaster.broadcast("copycat", {referer: request.headers.referer, request_string: reqToString});
        respond(response,200,"{}");
        return;
      }

      try {
        var parts = url.parse(request.url, true);
        var query = parts.query || {};
        query.lang = get_lang_from_header(query.lang||null,request.headers);
        query.v    = query.v || 0; // client version
        query.ref  = query.ref || ''; // referrer
        switch (parts.pathname) {
          case '/favicon.ico': break; // ignore
          case '/share':  output=share(query);  break;
          case '/latest': output=latest(query); break;
          case '/dump':   output=dumps(query);  break;
          case '/stats':  output=stats(query);  break;
          case '/':       output=old(query);    break; // map old-style: TODO: remove once caches flush
          default: invalid(request);            break;
        }
      } catch(e) {
        internal_error(request, e);
        respond(response,500,"Internal error.");
        return;
      }
      if (query.callback) {
        output = query.callback + "(" + output + ")";
      }
    respond(response,200,output);
  });
  http_server.listen(LOG_SERVER_PORT, '0.0.0.0');
  
  sys.puts('Log Server running on port '+LOG_SERVER_PORT);
  return http_server;
}
)(share_logger,shares,query_logger,server_stats);


var socket_server = io.listen(http_server, {
	transports: ['websocket', 'htmlfile', 'xhr-multipart', 'xhr-polling'],
});

//////////////////
//  broadcaster //
//////////////////

var broadcaster = (function(s) {
  var clients = [];
  net.createServer(function (stream) {
    stream.setEncoding('utf8');
    stream.addListener("error", function(e) {
      removeElement(clients, stream);
      broadcast("broadcast:error", {num_clients: clients.length});
      if (DEBUG) { sys.puts('broadcaster: error: '+e+' num_clients='+clients.length); }
    });
    stream.addListener('close', function () {
      removeElement(clients, stream);
      broadcast("broadcast:disconnect", {num_clients: clients.length});
      if (DEBUG) { sys.puts('broadcaster: close. num_clients='+clients.length); }
    });
    stream.addListener("connect", function() {
      // send the stats immediately to the new client (and flush the stream buffer)
      broadcast('stats',s.get(),[stream],true);
      clients.push(stream);
      broadcast("broadcast:connect", {num_clients: clients.length});
      if (DEBUG) { sys.puts('broadcaster: connect. num_clients='+clients.length); }
    });
  }).listen(BROADCASTER_PORT);

  sys.puts('Broadcaster running on port '+BROADCASTER_PORT);

  function broadcast(kind,object,client_list,flush) {
    var message='';
    client_list = client_list || clients;

    var out = {
      t: +new Date(),         // all outgoing msgs have a timestamp
      kind: kind              // and a category
    };
    for (var p in object) {
      out[p] = object[p];     // shallow copy object to be sent
    }

    // a browser won't see anything on connect unless we flush the buffer
    if (flush) {
      for (var i=0;i<1000;i++) { message += ' '; }
      message += '\n';
    }

    var encoded = JSON.stringify(out);
    message += encoded + "\n";
    socket_server.broadcast(encoded);

    // sent to all clients
    client_list.forEach(function(client) {
      // test to see if the stream has closed (this can happen before the 'close' event arrives)
      if (client.fd) {
        client.write(message);
      }
    });
  }

  // does not preserve array order
  function removeElement(array, value) {
    var i = array.indexOf(value);
    if (i !== -1) {
      array[i]=array[array.length-1];
      array.length--;
    }
  }
  setInterval(function() { broadcast('stats',s.get() ); },10*1000); // broadcast stats regularly
  return {broadcast:broadcast};
}
)(server_stats);


