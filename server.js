var sys  = require('sys');
var http = require('http');
var url  = require('url');
var net  = require('net');
var fs   = require('fs');

var LOG_SERVER_PORT = 8000;    // for /latest?q=xxx&gender=any and /share?q=xxx&gender=any&count=11&userid=1058420149
var QUERY_LOG  = 'query.log';  // every query run on our site
var SHARE_LOG  = 'share.log';  // every query that's a candidate for recent searches
var STATE_FILE = 'saved.json'; // persisted server state

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
    var message = [timestamp, query.q, query.lang].join('\t') + "\n";
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
    var message = [+new Date(), query.q, query.lang, query.gender, query.count, query.userid].join('\t') + '\n';
    if (DEBUG>1) { sys.print(SHARE_LOG + ': '+message); }
    fs.write(share_file, message, null, 'utf-8' );
  }
  return {log:log};
}
)();


////////////////////////////////
// Maintain the latest shares //
////////////////////////////////
var shares = (function(stat_logger) {
  var MAX_AGE    = 2 * 1000; // regenerate results if older than this
  var MAX_EXAMPLES = 20;     // number of search terms to return per language
  var spamFilter = /anonboard/; //TODO: load this from disk

  var results = unpersist() || {
    lang : {
      'en-us': new_lang()
    }
  };

  if (DEBUG) { sys.puts('Restored state: '+JSON.stringify(results,null,2)); }

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
      state = JSON.parse(fs.readFileSync(STATE_FILE));
      // check it's a valid results object
      if (!state.lang) { state=null; }
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
    if (q.match(spamFilter)) { return; }
    var latest = get_lang(query.lang).latest;
    if (latest.indexOf(q) === -1) {          // we only want unique examples
      latest.unshift(q);
      while (latest.length > MAX_EXAMPLES) { // limit the number of examples
        latest.pop();
      } 
      update_lang_results(query.lang);
    }
  }
  
  function update_lang_results(lang) {
    var lang_result = get_lang(lang);
    var timestamp = +new Date();
    var min_timestamp = timestamp - MAX_AGE;
    if (lang_result.lastupdate < min_timestamp) {
      lang_result.lastupdate = timestamp;
      lang_result.output = JSON.stringify( lang_result.latest );
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

/////////////////
// log server  //
/////////////////
(function(share_logger,shares,query_logger) {
  // server stats
  var s = {
    uptime: {
      init: new Date().toLocaleString(),
      t0:   +new Date(),
      hour:0, min:0, sec:0
    },
    mem: null,       // nodejs mem usage
    reqs: {          // request counters
      total:0, share:0, latest:0, old:0, stats:0, invalid:0
    }
  };
  function share(query) {
    s.reqs.share++;
    share_logger.log(query);
    shares.add(query);
    return '"SHARED"'; // dummy string
  }
  function latest(query) {
    s.reqs.latest++;
    query_logger.log(query);
    return shares.get_results(query.lang);
  }
  function old(query) {
    s.reqs.old++;
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
  function div(num,d,decimals) { // divde and return with x decimal places
    var scale = Math.pow(10,decimals||0);
    return Math.floor(scale*num/d)/scale;
  }
  function stats(query) {
    s.reqs.stats++;
    var up = div(+new Date() - s.uptime.t0 , 1000);
    s.uptime.sec  = up % 60;
    s.uptime.min  = div(up,60) % 60;
    s.uptime.hour = div(up,(60*60));
    s.mem = process.memoryUsage();
    for (var p in s.mem) { s.mem[p] = div(s.mem[p],(1024*1024), 1); } // convert to mb
    return JSON.stringify(s,null,2);
  }
  function invalid(url) {
    s.reqs.invalid++;
    sys.puts('Invalid url: '+url);
  }
  function get_lang_from_header(override,headers) {
    var lang = '??', accept;
    if (override) { accept = override; }
    else if ('accept-language' in headers) {
      accept  = headers['accept-language'].toLowerCase();
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
  http.createServer(function (request, response) {
    s.reqs.total++;
    var output;
    try {
      var parts = url.parse(request.url, true);
      var query = parts.query || {};
      query.lang = get_lang_from_header(query.lang||null,request.headers);
      switch (parts.pathname) {
        case '/favicon.ico': break; // ignore
        case '/share':  output=share(query);  break;
        case '/latest': output=latest(query); break;
        case '/dump':   output=shares.dump(query.lastdump); break;
        case '/stats':  output=stats(query);  break;
        case '/':       output=old(query);    break; // map old-style: TODO: remove once caches flush
        default: invalid(request.url);        break;
      }
    } catch(e) {
      output=+new Date()+': Internal Err: '+e+'  URL='+request.url;
      sys.puts(output);
    }
    // TODO: 404s?
    response.writeHead(200, {
      'Content-Type'  : query.callback ? 'text/javascript' : 'text/plain',
      'Cache-Control' : 'no-cache, must-revalidate',
      'Pragma'        : 'no-cache'
    });
    if (query.callback) {
      output = query.callback + "(" + output + ")";
    }
    response.end(output);
  }
).listen(LOG_SERVER_PORT, '0.0.0.0');

sys.puts('Log Server running on port '+LOG_SERVER_PORT);

}
)(share_logger,shares,query_logger);




