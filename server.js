var sys  = require('sys');
var http = require('http');
var url  = require('url');
var net  = require('net');
var fs   = require('fs');

var LOG_SERVER_PORT = 8000;    // for /latest?q=xxx&gender=any and /share?q=xxx&gender=any&count=11&userid=1058420149
var QUERY_LOG  = 'query.log';  // every query run on our site
var SHARE_LOG  = 'share.log';  // every query that's a candidate for recent searches
var STATE_FILE = 'saved.json'; // persisted server state

// invoke with node server.js -debug for console logging
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
}
)();

////////////////////////////
// maintain the query log //
////////////////////////////
var query_logger = (function(stat_logger) {
  var log_file = fs.openSync(QUERY_LOG, 'a+');

  function log(query) {
    var timestamp = +new Date();
    stat_logger.update(timestamp);
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
  var spamFilter = /anonboard/;

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

  function dump() {
    return JSON.stringify(results,null,2);
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
    if (latest.indexOf(q) === -1) { latest.unshift(q); }     // we only want unique examples
    while (latest.length > 7)     { latest.pop(); }          // we only want 7 examples
  }


  function get_results(lang) {
    var lang_result = get_lang(lang);
    var min_timestamp = +new Date() - MAX_AGE;
    if (lang_result.lastupdate < min_timestamp) {
      lang_result.output = JSON.stringify( {latest: lang_result.latest, qpm:stat_logger.getCount()} );
    }
    return lang_result.output;
  }

  setInterval(persist, 30 * 1000);
  return {get_results:get_results, add:add, dump:dump};
}
)(stats);

/////////////////
// log server  //
/////////////////
(function(share_logger,shares,query_logger) {

  function share(query) {
    share_logger.log(query);
    shares.add(query);
    return '"SHARED"'; // dummy string
  }
  function latest(query) {
    query_logger.log(query);
    return shares.get_results(query.lang);
  }
  function invalid(url) {
    sys.puts('Invalid url: '+url);
  }
  http.createServer(function (request, response) {
    var output;
    try {
      var parts = url.parse(request.url, true);
      var query = parts.query || {};
      query.lang = query.lang || (request.headers['accept-language']||'').split(',')[0].toLowerCase();
      switch (parts.pathname) {
        case '/favicon.ico': break; // ignore
        case '/share':  output=share(query);  break;
        case '/latest': output=latest(query); break;
        case '/dump':   output=shares.dump(); break;
        default: invalid(request.url);        break;
      }
    } catch(e) {
      output=+new Date()+': Internal Err: '+e+'  URL='+request.url;
      sys.puts(output);
    }
    // TODO: no-cache? 404s?
    response.writeHead(200, {'Content-Type': query.callback ? 'text/javascript' : 'text/plain'});
    if (query.callback) {
      output = query.callback + "(" + output + ")";
    }
    response.end(output);
  }
).listen(LOG_SERVER_PORT, '0.0.0.0');

sys.puts('Log Server running on port '+LOG_SERVER_PORT);

}
)(share_logger,shares,query_logger);




