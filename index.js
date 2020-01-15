const cheerio = require('cheerio');
const request = require('request').defaults({
    headers: {
        'User-Agent': 'Docs Scraper'
    }
});
const fs = require("fs");
const path = require("path")

const RATE_LIMIT = 20;   // Amout of simultaneously running requests
const ERROR_TIMEOUT = 8; // Cooldown period if got error during request
const LUA_STATES = ['server', 'client', 'shared', 'menu'];

function parseFuncPage(url, callback) {
    request(url, function (err, resp, html) {
        if (err) {
            callback('Cant get: ' + url);
            return;
        }
        let url_slit = url.split("/");
        let name = url_slit[url_slit.length - 1];
        let scope = url_slit[url_slit.length - 2];
        let $ = cheerio.load(html);
        let data = {
            name: name,
            scope: scope,
            states: [],
            description: "",
            argsuments: [],
            returns: [],
            examples: []
        }
        let categories = $("#mw-normal-catlinks").html().toLowerCase();
        for (let state of LUA_STATES.values()) {
            if (categories.indexOf(state) != -1) {
                data.states.push(state);
            }
        }
        if (categories.indexOf("internal_functions") != -1) {
            data.internal = true;
        }
        if (categories.indexOf("deprecated_functions") != -1) {
            data.deprecated = true;
        }
        if (categories.indexOf("class_functions") != -1){
            data.classFunction = true;
            data.fullname = scope+":"+name;
        } else if(categories.indexOf("category:hooks")) {
            data.isHook = true
            data.fullname = scope+":"+name;
        } else {
            data.fullname = scope == "global" ? name : scope+"."+name;
        }
        // Hate this part, wiki html is such a mess
        let afeterDesc = $("#Description").parent().nextAll()
        for (descn = 0; descn < afeterDesc.length; descn++) {
            let elem = afeterDesc[descn];
            if (elem.type == "tag") {
                if (elem.name == "h1" || elem.name == "h2") {
                    break;
                }
                if (elem.name == "p") {
                    data.description += $(elem).text();
                }
            }
            if (elem.next.type == "text") {
                data.description += elem.next.data;
            }
        }
        data.description = data.description.trim();
        // data.description = $("#Description").parent().nextUntil("h1").text().slice(0,-1)
        $(".argument").each((index, elem) => {
            let desc = $("div", elem).text().trim();
            let type = $("p > .arg_chunk > a", elem).text();
            let name = $("p > .arg_chunk > a", elem)[0].next.data.trim();
            let argData = {
                name: name,
                type: type,
                desc: desc
            }
            if (name.indexOf("=")) {
                let split = name.split("=");
                argData.name = split[0];
                argData.defaultValue = split[1];
            }
            data.argsuments.push(argData);
        })
        $(".return").each((index, elem) => {
            let type = $("p > span > a", elem).text();
            let desc = $("div", elem).text().trim();
            data.returns.push({
                type: type,
                desc: desc
            })
        })
        $(".examples_number").each((index, elem) => {
            elem = $(elem);
            let desc = elem.next("p").text().trim();
            let output = elem.nextUntil(".first_example").last().text().trim(); // will probably break if has picture or anything else
            let code = elem.nextUntil("pre").next().text();
            data.examples.push({
                desc: desc,
                code: code,
                output: output
            })
        })
        // console.log(data);
        callback(null, data);
    });
}

function parseEnumPage(url, callback) {
    request(url, (err, resp, html) => {
        if (err) {
            callback('Cant get: ' + url);
            return;
        }
        let url_slit = url.split("/");
        let name = url_slit[url_slit.length - 1];
        let $ = cheerio.load(html);
        let rows = $(".wikitable > tbody > tr");
        let data = {
            name: name,
            entires: []
        };
        rows.each((index, elem) => {
            elem = $(elem);
            if(index == 0 ) {
                return; // Skip header
            }
            let table_data = elem.children("td");
            data.entires.push({
                name  : $(table_data[0]).text().trim(),
                value : $(table_data[1]).text().trim(),
                desc  : $(table_data[2]).text().trim()
            })
        })
        callback(null, data);
    } )
}

function parseListPage(url, parserFunc, callback) {
    request(url, function (err, resp, html) {
        if(err) {
            callback(err);
            return;
        }
        $ = cheerio.load(html);
        let pages = [];
        $("ul > li > a","#mw-pages").each(function(index, elem) {
            pages.push("https://wiki.garrysmod.com"+elem.attribs.href);
        })
        let total_count = pages.length;
        console.log(`Parsing ${total_count} pages from ${url}`);
        let entires = [];
        let done = false;
        let shiftAndRequest = function() {
            if(pages.length == 0){
                if(!done){
                    done = true;
                    callback(null, entires);
                }
                return;
            }
            let page = pages.shift();
            parserFunc(page,(err, data) => {
                if(err) {
                    // console.log("Error geting " + page + " retrying in "+ERROR_TIMEOUT+" seconds")
                    setTimeout(shiftAndRequest, ERROR_TIMEOUT * 1000);
                    return;
                }
                entires.push(data);
                shiftAndRequest();
            })
            process.stdout.write(`Processing: ${entires.length}/${total_count} (${Math.round((entires.length/total_count) * 100)}%)\r`);
        }
        for(i = 0; i < RATE_LIMIT ; i ++) {
            shiftAndRequest();
        }
    } )
}

function parseAndWrite(url, filename, pageParser, callback) {
    parseListPage(url, pageParser, (err,entires) => {
        if(err) {
            callback(`Cant parse ${url}: ${err}`);
            return;
        }
        filename = path.resolve(__dirname, filename);
        let jsonData = JSON.stringify(entires)
        let file = fs.openSync(filename, 'w');
        fs.writeSync(file, jsonData);
        fs.closeSync(file);
        callback(err, entires);
    } );
}

let queue = [
    ["https://wiki.garrysmod.com/page/Category:Enumerations", "enums.json" , parseEnumPage, ((err,entires) => {if(!err){console.log("Done parsing enums!");}})],
    ["https://wiki.garrysmod.com/page/Category:Functions", "functions.json" ,parseFuncPage, (err,entires) => {if(!err){console.log("Done parsing functions!");}}],
    ["https://wiki.garrysmod.com/page/Category:Hooks", "hooks.json" ,parseFuncPage, (err,entires) => {if(!err){console.log("Done parsing hook!");}}],
]

function processQueue() {
    if(queue.length == 0){
        return;
    }
    let elem = queue.shift();
    parseAndWrite(elem[0], elem[1], elem[2], (err, data) => {
        elem[3](err, data);
        if(err) {
            return;
        }
        processQueue();
    })
}

processQueue();