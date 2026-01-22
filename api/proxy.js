// api/proxy.js
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

        // Get the response text first to handle errors gracefully
        const responseText = await response.text();

        // Try to parse as JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            // If API returns non-JSON error (like 404 HTML)
            return res.status(response.status).json({ error: responseText });
        }

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}