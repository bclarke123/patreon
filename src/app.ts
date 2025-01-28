import Koa, { Context } from 'koa';
import Router from 'koa-router';
import session from 'koa-session';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromEnv } from '@aws-sdk/credential-providers';

require('dotenv').config();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

const bucket = process.env.BUCKET_NAME;
const file = process.env.FILE_KEY;

const apiUrl = (path: string) => `https://www.patreon.com/${path}`;

const app = new Koa();

app.keys = [ process.env.SESSION_KEY ];
app.use(session(app));

const router = new Router();

router.get('/login', async (ctx: Context) => {
    const scope = 'identity campaigns';
    const redirect = encodeURIComponent(redirectUri || '');
    const state = ((Math.random() * 0x1000000) | 0).toString(16).padStart(6, '0');

    ctx.session.state = state;

    const url = apiUrl(`oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&scope=${scope}&state=${state}`);

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

    ctx.session.state = undefined;

    const request = await fetch(apiUrl('api/oauth2/token'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            code: code as string,
            grant_type: 'authorization_code',
            client_id: clientId || '',
            client_secret: clientSecret || '',
            redirect_uri: redirectUri || ''
        })
    });

    const response = await request.json();

    if (response.error) {
        ctx.status = 400;
        ctx.body = response.error;
        return;
    }

    const authToken = response.access_token;

    ctx.session.authToken = authToken;

    ctx.status = 302;
    ctx.set('Location', '/user');
});

router.get('/user', async (ctx: Context) => {
    const authToken = ctx.session.authToken;

    const userRequest = await fetch(apiUrl('api/oauth2/v2/identity?include=memberships'), {
        headers: {
            Authorization: `Bearer ${authToken}`
        }
    });

    const userResponse = await userRequest.json();

    if (userResponse.error) {
        ctx.status = 302;
        ctx.set('Location', '/login');
        return;
    }

    const { data } = userResponse;
    const memberships = data?.relationships?.memberships?.data;

    if (!memberships) {
        ctx.status = 400;
        ctx.body = 'No memberships found';
        return;
    }

    const [ membership ] = memberships;

    if (membership) {
        // generate a presigned URL to access the S3 bucket
        const s3 = new S3Client({
            region: 'us-east-1',
            credentials: fromEnv()
        });

        const command = new GetObjectCommand({
            Bucket: bucket || '',
            Key: file || ''
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

        ctx.status = 302;
        ctx.set('Location', url);
        return;
    }

    ctx.status = 400;
    ctx.body = 'No membership found';
});

app.use(router.routes());

export default app;