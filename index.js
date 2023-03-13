const config = require('./config.json');

const Buff163 = require('./Buff163');

const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');

const steamClient = new SteamUser();
const community = new SteamCommunity();

const manager = new TradeOfferManager({
    steam: steamClient,
    community: community,
    language: 'en'
});

steamClient.on('loggedOn', async () => 
{
    console.log(`[Steam] Logged into ${config.steam.username}`);
  
    steamClient.setPersona(SteamUser.EPersonaState.Online);
    steamClient.gamesPlayed(730);
});

steamClient.on('webSession', (sessionid, cookies) => 
{
    console.log(`[Steam] Web session started (${sessionid})`);

    manager.setCookies(cookies);

    community.setCookies(cookies);
    community.startConfirmationChecker(manager.pollInterval, config.steam.identity_secret); 
});

function Login()
{
    steamClient.logOn({
        accountName: config.steam.username,
        password: config.steam.password,
        twoFactorCode: SteamTotp.generateAuthCode(config.steam.shared_secret)
    });

    setInterval(
        async () =>
        {
            let ids = await Buff163.GetTradesToAccept();

            console.log(`[Buff] Found ${ids.length} trades to accept.`)

            for (let id of ids)
            {
                manager.getOffer(
                    id,
    
                    (err, offer) =>
                    {
                        if (!err)
                            offer.accept((_err, _status) => { });  
                    }
                );                       
            }
        }, 

        60 * 1000
    );
}

Login();