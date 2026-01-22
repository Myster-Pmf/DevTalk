// api/proxy-stream.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { targetUrl, apiKey, body } = req.body;

    if (!targetUrl || !body) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).send(errorText);
        }

        // Set headers for SSE/streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Pipe the response body directly to the client
        const reader = response.body.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Write chunk to response
                res.write(Buffer.from(value));
            }
        } finally {
            reader.releaseLock();
        }

        res.end();

    } catch (error) {
        console.error('Proxy stream error:', error);
        return res.status(500).send(error.message);
    }
}
