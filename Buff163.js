const fs = require('fs');
const axios = require('axios');

const puppeteer = require('puppeteer');

const buff_cookies = fs.readFileSync(
    'cookies.txt', 
    'utf8'
);;

const Buff163 = axios.create({ 
    baseURL: 'https://buff.163.com/api' 
});

let CSRFToken;

Buff163.interceptors.request.use(
    config => 
    {
        let cookies_being_sent = buff_cookies;

        if (CSRFToken)
        {
            cookies_being_sent += ` csrf_token=${CSRFToken};`;

            config.headers['X-CSRFToken'] = CSRFToken;
        }
        
        config.headers['Cookie'] = cookies_being_sent.replace(/\r?\n|\r/g, '');
        config.headers['X-Requested-With'] = "XMLHttpRequest";
        config.headers['User-Agent'] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36";
        
        return config;
    },
    error => Promise.reject(error)
);

Buff163.interceptors.response.use((response) =>
{
    let new_cookies = response.headers['set-cookie'];
        new_cookies = new_cookies.map((x) => ConvertCookieSTRToOBJ(x));

    let { csrf_token } = new_cookies.find((x) => x['csrf_token']);

    CSRFToken = csrf_token;    

    return response;
});

function ConvertCookieSTRToOBJ(str) 
{
    str = str.split('; ');

    let result = { };

    for (var i = 0; i < str.length; i++) 
    {
        var cur = str[i].split('=');

        result[cur[0]] = cur[1];
    }

    return result;
}

function GetBuffCookiesObj()
{
    let split = buff_cookies.split(";");
    let cookies = [];

    for (let i = 0; i < split.length; i++)
    {
        let [name, value] = split[i].split("=");

        name = name?.trim() ?? "";
        value = value?.trim() ?? "";

        cookies.push({ name, value, domain: "buff.163.com" });
    }

    cookies = cookies.filter((x) => !(!x.name || !x.value));

    return cookies;
}

module.exports.GetTradesToAccept = async function GetTradesToAccept()
{
    let { data: { data } } = await Buff163.get("/market/steam_trade", { params: { _: Date.now() } });
    
    let ids = data.map(({ tradeofferid }) => tradeofferid);

    return [...new Set(ids)];
}

module.exports.GetBalanceUSD = async function GetBalanceUSD()
{
    try
    {
        let { data: { Rates } } = await axios.get("https://api.dmarket.com/currency-rate/v1/rates");

        console.log("[Buff163] CNY to USD Rate: " + Rates.CNY);

        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox"]
        });
    
        const page = await browser.newPage();
    
        await page.setViewport({ width: 1920, height: 1080 });
        
        page.goto("https://buff.163.com/market/buy_order/history?game=csgo");
        page.setCookie(...GetBuffCookiesObj());
    
        await page.waitForNetworkIdle({ idleTime: 1000 });
    
        const element = await page.$("#navbar-cash-amount");
        const text = await page.evaluate(el => el.textContent, element);

        let cny = +text.replace("¥ ", "");

        const tr_elements = await page.$$("tr");

        for (let i = 0 ; i < tr_elements.length; i++)
        {
            const text = await page.evaluate(el => el.textContent, tr_elements[i]);

            if (text.includes("Success") || text.includes("Buy failed-refunded"))
                continue;

            const words = text.split(" ");
            const index = words.findIndex((x) => x === "¥");

            if (index !== -1)
            {
                cny += +(words[index + 1].trim());
            }
        }

        await browser.close();

        return cny / Rates.CNY;
    }
    catch 
    {
        return 0;
    }
}