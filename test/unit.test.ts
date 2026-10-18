import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReelLinks, formatClock, parseShortcode } from "../src/parse.js";
import { frameTimes } from "../src/tools/fetch.js";
import { findHighlights } from "../src/highlights.js";

test("shortcodes from every URL shape", () => {
  assert.equal(parseShortcode("https://www.instagram.com/reel/DNkpzuaRy-5/"), "DNkpzuaRy-5");
  assert.equal(parseShortcode("https://instagram.com/reels/Cop84x6u7CP/?igsh=abc"), "Cop84x6u7CP");
  assert.equal(parseShortcode("https://www.instagram.com/mosseri/reel/DNkpzuaRy-5/"), "DNkpzuaRy-5");
  assert.equal(parseShortcode("https://www.instagram.com/p/DS60m9xkTkH/"), "DS60m9xkTkH");
  assert.equal(parseShortcode("DNkpzuaRy-5"), "DNkpzuaRy-5");
  assert.equal(parseShortcode("https://example.com/x"), undefined);
});

test("links from HTML, escaped JSON and URL-encoded embeds", () => {
  const html = `<a href="https://www.instagram.com/reel/AAAAAAAAAAA/">x</a>
    {"url":"https:\\/\\/www.instagram.com\\/reel\\/BBBBBBBBBBB\\/"}
    <iframe src="https://e.com/?u=https%3A%2F%2Fwww.instagram.com%2Freel%2FCCCCCCCCCCC%2F"></iframe>
    <a href="https://www.instagram.com/p/DDDDDDDDDDD/">post</a>
    <a href="https://www.instagram.com/reel/AAAAAAAAAAA/?utm=1">dup</a>`;
  assert.deepEqual(extractReelLinks(html), [
    { code: "AAAAAAAAAAA", kind: "reel" },
    { code: "BBBBBBBBBBB", kind: "reel" },
    { code: "CCCCCCCCCCC", kind: "reel" },
    { code: "DDDDDDDDDDD", kind: "post" },
  ]);
});

test("frame timestamps", () => {
  assert.deepEqual(frameTimes({ frames: 3 }, 0, 6, 45), [0, 2, 4]);
  assert.deepEqual(frameTimes({ frames: 2 }, 0, Infinity, 10), [0, 5]);
  assert.deepEqual(frameTimes({ frameAt: [1, 50] }, 0, Infinity, 14), [1]);
  assert.deepEqual(frameTimes({ frames: 3 }, 0, Infinity, undefined), []);
  assert.equal(formatClock(75.4), "1:15");
});

test("passage search on transcript segments", () => {
  const segs = [
    { start: 0, dur: 3, text: "Today I want to talk about where Instagram is going." },
    { start: 9, dur: 4, text: "go to insights and check your drop-off rate" },
  ];
  assert.equal(findHighlights(segs, ["drop-off rate"], { count: 1, windowSec: 5 })[0].start, 9);
});
