const fs = require('fs');
const axios = require('axios');
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
module.exports.GetHistory = async function GetHistory(game = 'csgo') {

    // Function for retrieving purchase history
    const getBuyOrderHistory = async (data) => {
        try {
            if (data.page_num <= data.total_page) {
                let response = await Buff163.get(`/market/buy_order/history?game=${game}&page_num=${data.page_num}&page_size=10`);
                let next = response.data.data;
                data.page_num = next.page_num + 1;
                data.total_page = next.total_page;
                data.items = [...(data.items || []), ...next.items];
                data.goods_infos = { ...(data.goods_infos || []), ...next.goods_infos };
                data.user_infos = { ...(data.user_infos || []), ...next.user_infos };
                await new Promise(resolve => setTimeout(resolve, 500));
                return getBuyOrderHistory(data);
            } else {
                return data;
            }
        } catch (error) {
            console.error(`[Buff163] Error fetching buy order history: ${error.message}`);
            throw error;
        }
    };

    // Function for obtaining exchange rate with caching
    const getCachedExchangeRate = (() => {
        const cache = {};

        return async (date) => {
            if (cache[date]) {
                return cache[date];
            }

            const baseCurrency = 'USD';
            const targetCurrency = 'CNY';
            const url = `https://query1.finance.yahoo.com/v7/finance/download/${baseCurrency}${targetCurrency}=X?period1=${date}&period2=${date}&interval=1d&events=history`;
            try {
                console.log(`[Buff163] Fetching exchange rate for ${date}...`);
                let response = await axios.get(url);
                let rate = +response.data.split(',').slice(-2).shift();
                cache[date] = rate;
                return rate;
            } catch (error) {
                console.error(`[Buff163] Error fetching exchange rate: ${error.message}`);
                throw error;
            }
        };
    })();

    try {
        let data = await getBuyOrderHistory({ page_num: 1, total_page: 2 });
        let items = data.items;

        // Grouping by day
        let groupDaily = items.filter(i => i.state != 'FAIL').reduce((acc, item) => {
            const date = new Date((item.buyer_pay_time || item.transact_time) * 1000);
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const dayText = `${year}/${month}/${day}`;
            if (!acc[dayText]) {
                acc[dayText] = [item];
            } else {
                acc[dayText].push(item);
            }
            return acc;
        }, {});

        // Group processing
        for await (const [key, items_] of Object.entries(groupDaily)) {
            let transactTime = items_[0].transact_time || items_[0].buyer_pay_time;
            let rate = await getCachedExchangeRate(transactTime);
            items_.forEach((item) => {
                item.price_usd = +(item.price / rate);
                item.rateCNY = rate;
            });
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Preparation of the final result
        return items.map(item => {
            return {
                market_hash_name: data.goods_infos[item.asset_info.goods_id].market_hash_name,
                price_usd: item.price_usd,
                price: item.price,
                state: item.state,
                date: new Date((item.buyer_pay_time || item.transact_time) * 1000)
            };
        });
    } catch (error) {
        console.error(`[Buff163] Error in GetHistory: ${error.message}`);
        throw error;
    }
};
module.exports.GetBalanceUSD = async function GetBalanceUSD(game = 'csgo') {
    try {
        let { data: { Rates } } = await axios.get("https://api.dmarket.com/currency-rate/v1/rates");
        let cny = 0;
        console.log("[Buff163] CNY to USD today rate: " + Rates.CNY);
        let records = await module.exports.GetHistory(game);
        for (let i = 0; i < records.length; i++) {
            let item = records[i];
            if (item.state == 'SUCCESS' || item.state == 'FAIL')
                continue;
            cny += +item.price;
            item.price_usd_dm = +item.price / Rates.CNY;
            console.log(`[Buff163] ${item.market_hash_name} - ${item.price} CNY, ${item.price_usd} USD(yahoo), ${item.price_usd_dm} USD (DMarket)`);
        }
        return cny / Rates.CNY;
    }catch(e) {
        return 0;
    }
}