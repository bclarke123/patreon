import Koa, { Context } from 'koa';
import Router from 'koa-router';
import session from 'koa-session';

require('dotenv').config();

const clientId = process.env.CLIENT_ID;
const redirectUri = process.env.REDIRECT_URI;

const app = new Koa();
app.keys = [ process.env.SESSION_KEY ];

app.use(session(app));
const router = new Router();


router.get('/login', async (ctx: Context) => {
    const domain = 'https://www.patreon.com/oauth2/authorize';
    const scope = 'identity';
    const redirect = encodeURIComponent(redirectUri || '');
    const state = ((Math.random() * 0x1000000) | 0).toString(16).padStart(6, '0');

    ctx.session.state = state;

    const url = `${domain}?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&scope=${scope}&state=${state}`;

    ctx.status = 302;
    ctx.set('Location', url);
});

router.get('/oauth/callback', async (ctx: Context) => {
    const { code, state } = ctx.query;
    const sessionState = ctx.session.state;

    if (state !== sessionState) {
        ctx.status = 400;
        ctx.body = 'Invalid state';
        return;
    }

    if (!code) {
        ctx.status = 400;
        ctx.body = 'Code not found';
        return;
    }

    ctx.status = 200;
    ctx.body = 'Code: ' + code;
});

app.use(router.routes());

export default app;