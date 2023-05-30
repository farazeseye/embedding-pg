process.env.PUPPETEER_PRODUCT = 'chrome';
import { PGChunk, PGEssay, PGJSON } from "@/types";
import puppeteer from 'puppeteer';
import { encode } from 'gpt-3-encoder';
import fs from "fs";


const BASE_URLS = [
    "https://docs.eseye.com/Content/Home.htm",
    "https://docs.eseye.com/Content/HardwareProducts/HardwareProducts.htm",
    "https://docs.eseye.com/Content/SoftwareProducts/SoftwareProducts.htm",
    "https://docs.eseye.com/Content/Connectivity/ConnectivityIntro.htm",
    "https://docs.eseye.com/Content/ManagingMyEstate/ManagingMyEstate.htm",
    "https://docs.eseye.com/Content/DeveloperDocs/GettingStartedForDevelopers.htm"
];

const EXCLUDE_URLS = [
    "https://www.eseye.com/privacy-policy/",
    "https://www.eseye.com/company/policies/privacy-policy/",
    "https://privacy.microsoft.com/en-us/privacystatement",
    "https://privacy.microsoft.com/en-US/privacystatement",
    "https://www.eseye.com/company/policies/cookie-policy/",
    "https://www.cookiebot.com/en/what-is-behind-powered-by-cookiebot/",
    "https://www.cookiebot.com/goto/privacy-policy/",
    "https://www.linkedin.com/legal/privacy-policy",
    "https://policies.google.com/privacy",
    "https://www.eseye.com/company/policies/terms-conditions/",
    "https://www.cookiebot.com/"
];

const CHUNK_SIZE = 200;


////////////////////////////////////////////////////////////////////////////////////////////////////
const getLinks = async(url:string) => {
    process.env.PUPPETEER_PRODUCT = 'chrome';
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForSelector('a');
  
    const linksArr = await page.evaluate((EXCLUDE_URLS) => {
      const links = Array.from(document.querySelectorAll('a'));
  
      return links.map(link => ({
        url: link.href,
        title: link.textContent || '',
      })).filter(link => link.url && link.title && !link.url.endsWith('.pdf') && link.url !== 'javascript:void(0);' && !EXCLUDE_URLS.includes(link.url));
    }, EXCLUDE_URLS);
  
    await browser.close();
    return linksArr;
  };  
////////////////////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////////////////////
const chunkEssay = async (essay: PGEssay): Promise<PGEssay | null> => {
    const { title, url, content } = essay;
    let essayTextChunks = [];

    // Ignore if the content is "We do not use cookies of this type."
    if (content.trim() === "We do not use cookies of this type.") {
        return null;
    }

    if (encode(content).length > CHUNK_SIZE) {
      const split = content.split(". ");
      let chunkText = "";

      for (let i = 0; i < split.length; i++) {
        const sentence = split[i];
        const sentenceTokenLength = encode(sentence).length;
        const chunkTextTokenLength = encode(chunkText).length;

        if (chunkTextTokenLength + sentenceTokenLength > CHUNK_SIZE) {
          essayTextChunks.push(chunkText);
          chunkText = "";
        }

        if (sentence[sentence.length - 1]?.match(/[a-z0-9]/i)) {
          chunkText += sentence + ". ";
        } else {
          chunkText += sentence + " ";
        }
      }

      essayTextChunks.push(chunkText.trim());
    } else {
      essayTextChunks.push(content.trim());
    }

    const essayChunks = essayTextChunks.map((text) => {
      const trimmedText = text.trim();

        // Ignore if the content is "We do not use cookies of this type."
        if (trimmedText === "We do not use cookies of this type.") {
            return null;
        }

      const chunk: PGChunk = {
        essay_title: title,
        essay_url: url,
        content: trimmedText,
        content_length: trimmedText.length,
        content_tokens: encode(trimmedText).length,
        embedding: []
      };

      return chunk;
    }).filter((chunk): chunk is PGChunk => chunk !== null); // Exclude chunks that are undefined or null

    if (essayChunks.length > 1) {
        for (let i = 0; i < essayChunks.length; i++) {
            const chunk = essayChunks[i];
            const prevChunk = essayChunks[i - 1];
        
            if (chunk && chunk.content_tokens < 100 && prevChunk) {
                prevChunk.content += " " + chunk.content;
                prevChunk.content_length += chunk.content_length;
                prevChunk.content_tokens += chunk.content_tokens;
                essayChunks.splice(i, 1);
                i--;
            }
        }
        
    }

    return {
      ...essay,
      chunks: essayChunks
    };
};


////////////////////////////////////////////////////////////////////////////////////////////////////

const removeInvisibleCharacters = (content: string): string => {
    return content.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

////////////////////////////////////////////////////////////////////////////////////////////////////
const getEssay = async (linkObj: { url: string; title: string }): Promise<PGEssay[] | null> => {
    process.env.PUPPETEER_PRODUCT = 'chrome';
    const { title, url } = linkObj;
  
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const essays: PGEssay[] = [];
    const pElements = await page.$$('body p');

    for (const pElement of pElements) {
        let content = await page.evaluate(p => p.textContent || '', pElement);
        content = content.replace(/\n/g, ' ');

        // Remove invisible characters
        content = removeInvisibleCharacters(content);

        // Ignore if the content is "We do not use cookies of this type."
        if (content.trim() === "We do not use cookies of this type.") {
            continue;
        }

        if (content.trim().length <= 1) {
            continue;
        }

        const tokens = encode(content).length;
        const essay: PGEssay = {
            title: title,
            url: url,
            content: content,
            tokens: tokens,
            chunks: [],
        };
    
        const chunkedEssay = await chunkEssay(essay);
        if (chunkedEssay) { // Skip essays that were excluded due to unwanted content
            essays.push(chunkedEssay);
        } else {
            await browser.close();
            return null; // return null if chunkEssay returned undefined
        }
    }
  
    await browser.close();
    if (essays.length === 0) {
        return null;
    } else {
        return essays;
    }
};
////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////
(async () => {
    // Create a Set to keep track of visited URLs
    const visitedUrls = new Set<string>();
    let links: { url: string; title: string }[] = [];
    let essays: PGEssay[] = [];
    
    const filteredBaseUrls = BASE_URLS.filter(url => !EXCLUDE_URLS.includes(url));

    for(const url of filteredBaseUrls) {
        const newLinks = await getLinks(url);
        links = [...links, ...newLinks]; // Append new links to the links array

        for (const link of newLinks) {
            // If the URL has already been visited, skip this iteration
            if (visitedUrls.has(link.url)) {
                continue;
            }
            const newEssays = await getEssay(link);
            if (newEssays !== null) {
                essays.push(...newEssays); // Append new essays to the essays array
            }
            // Add the URL to the set of visited URLs
            visitedUrls.add(link.url);
        }
    }

    const json: PGJSON = {
        total_tokens: essays.reduce((acc, essay) => acc + essay.tokens, 0),
        total_essays: essays.length,
        essays: essays
    };

    fs.writeFileSync("scripts/pg.json", JSON.stringify(json));

})();