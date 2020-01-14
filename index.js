const cheerio = require('cheerio');
const request = require('request').defaults({
    headers: {
        'User-Agent': 'Docs Scraper'
    }
});
const fs = require("fs")

const RATE_LIMIT = 20   // Amout of simultaneously running requests
const ERROR_TIMEOUT = 8 // Cooldown period if got error during request
const LUA_STATES = ['server', 'client', 'shared', 'menu'];

function parseFuncPage(url, callback) {
    request(url, function (err, resp, html) {
        if (err) {
            callback('Cant get: ' + url);
            return;
        }
        let url_slit = url.split("/")
        let name = url_slit[url_slit.length - 1]
        let scope = url_slit[url_slit.length - 2]
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
            data.classFunction = true
            data.fullname = scope+":"+name
        } else if(categories.indexOf("category:hooks")) {
            data.isHook = true
            data.fullname = scope+":"+name
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
        $(".argument").each(function (index, elem) {
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
            data.argsuments.push(argData)
        })
        $(".return").each(function (index, elem) {
            let type = $("p > span > a", elem).text();
            let desc = $("div", elem).text().trim();
            data.returns.push({
                type: type,
                desc: desc
            })
        })
        $(".examples_number").each(function (index, elem) {
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

function parseListPage(url, callback) {
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
        let total_count = pages.length
        console.log(`Parsing ${total_count} pages from ${url}`)
        let entires = []
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
            parseFuncPage(page,function(err, data){
                if(err) {
                    // console.log("Error geting " + page + " retrying in "+ERROR_TIMEOUT+" seconds")
                    setTimeout(shiftAndRequest, ERROR_TIMEOUT * 1000);
                    return;
                }
                entires.push(data);
                shiftAndRequest()
            })
            process.stdout.write(`Processing: ${entires.length}/${total_count} (${Math.round((entires.length/total_count) * 100)}%)\r`);
        }
        for(i = 1; i < RATE_LIMIT ; i ++) {
            shiftAndRequest()
        }
    } )
}

parseListPage("https://wiki.garrysmod.com/page/Category:Functions",function(err,entires){
    let jsonData = JSON.stringify(entires)
    let file = fs.openSync("functions.json", 'w');
    fs.writeSync(file, jsonData)
    fs.closeSync(file)
    console.log("All functions are parsed, parsing hooks")
    parseListPage("https://wiki.garrysmod.com/page/Category:Hooks", function(err, entires) {
        let jsonData = JSON.stringify(entires)
        let file = fs.openSync("hooks.json", 'w');
        fs.writeSync(file, jsonData)
        fs.closeSync(file)
    } )
})