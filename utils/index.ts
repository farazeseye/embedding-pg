import { createClient } from "@supabase/supabase-js";
import { createParser , ParsedEvent, ReconnectInterval } from "eventsource-parser";

export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const OpenAIStream = async (prompt:string) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`
        },
        body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
            {
                role: "system",
                content: `You are a helpful chatbot assistant that is designed to help a company called Eseye respond to any customer queries. Eseye are a market leader in IoT, helping companies with connectivity challenges all around the world.`
            }, 
            {
                role: "user",
                content: prompt
            }
        ],
        max_tokens: 200,
        temperature: 0.0,
        stream: true
        })
    });

    if (response.status !==200) {
        throw new Error("Error");
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
        async start(controller) {
            const onParse = (event: ParsedEvent | ReconnectInterval) => {
                if (event.type === "event") {
                    const data = event.data;

                    if(data === "[DONE]") {
                        controller.close();
                        return;
                    }

                    try {
                        const json = JSON.parse(data);
                        const text = json.choices[0].delta.content
                        const queue = encoder.encode(text)
                        controller.enqueue(queue);
                    } catch(e) {
                        controller.error(e);
                    }
                }
            };
            const parser = createParser(onParse);

            for await (const chunk of response.body as any) {
                parser.feed(decoder.decode(chunk));
            }
        }
    });
    return stream;
};