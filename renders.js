
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const inputDir = "./input";
const outputDir = "./output";
const renderedDir = "./rendered";

const dataPath = path.join(inputDir, "data.json");

const PAGE_WIDTH = 1080;
const PAGE_HEIGHT = 1350;
const JPEG_QUALITY = 90;

let data = {};

// HTML 특수문자 처리
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 배열 및 객체를 HTML에 표시할 문자열로 변환
function formatValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(item => formatValue(item))
      .join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

// 객체의 경로로 데이터 가져오기
function getValueByPath(object, expression) {
  const parts = expression
    .trim()
    .split(".")
    .filter(Boolean);

  let current = object;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

// HTML 표현식 처리
function resolveExpression(expression) {
  const expr = expression.trim();

  // 일반 데이터 경로
  const value = getValueByPath(data, expr);

  if (value !== undefined) {
    return escapeHtml(formatValue(value));
  }

  // 배열 인덱스 표현식 예: page1.news_summary[0].title
  const normalized = expr.replace(
    /\[(\d+)\]/g,
    ".$1"
  );

  const indexedValue = getValueByPath(
    data,
    normalized
  );

  if (indexedValue !== undefined) {
    return escapeHtml(formatValue(indexedValue));
  }

  console.warn(
    "데이터를 찾을 수 없습니다:",
    expr
  );

  return "";
}

// HTML 템플릿에 JSON 데이터 삽입
function renderTemplate(html, fileName) {
  return html.replace(
    /\{\{([\s\S]*?)\}\}/g,
    (match, expression) => {
      const result = resolveExpression(expression);

      return result;
    }
  );
}

// JSON 데이터 검사
function validateData() {
  if (!data || typeof data !== "object") {
    throw new Error(
      "JSON 데이터가 올바른 객체 형식이 아닙니다."
    );
  }

  if (!data.market_date) {
    throw new Error(
      "market_date 데이터가 없습니다."
    );
  }

  if (
    !Array.isArray(data.news_top3) ||
    data.news_top3.length === 0
  ) {
    throw new Error(
      "news_top3 뉴스 데이터가 없습니다."
    );
  }

  for (let i = 1; i <= 4; i++) {
    const pageKey = `page${i}`;

    if (
      !data[pageKey] ||
      typeof data[pageKey] !== "object"
    ) {
      throw new Error(
        `${pageKey} 데이터가 없습니다.`
      );
    }

    if (!data[pageKey].title) {
      throw new Error(
        `${pageKey}.title 데이터가 없습니다.`
      );
    }
  }

  console.log("JSON 필수 데이터 검사 완료");
}

// 기존 이미지 삭제
function cleanOutputDirectory() {
  fs.mkdirSync(outputDir, {
    recursive: true
  });

  fs.mkdirSync(renderedDir, {
    recursive: true
  });

  for (const file of fs.readdirSync(outputDir)) {
    if (/^page[1-4]\.(jpg|jpeg|png)$/i.test(file)) {
      fs.unlinkSync(
        path.join(outputDir, file)
      );
    }
  }

  for (const file of fs.readdirSync(renderedDir)) {
    if (/^page[1-4]\.html$/i.test(file)) {
      fs.unlinkSync(
        path.join(renderedDir, file)
      );
    }
  }

  console.log("기존 이미지 및 렌더링 파일 정리 완료");
}

// HTML 파일 확인
function getHtmlFiles() {
  const files = fs.readdirSync(inputDir)
    .filter(file => /^page[1-4]\.html$/i.test(file))
    .sort((a, b) => {
      const numA = Number(a.match(/\d+/)[0]);
      const numB = Number(b.match(/\d+/)[0]);

      return numA - numB;
    });

  if (files.length !== 4) {
    throw new Error(
      `HTML 파일은 page1.html부터 page4.html까지 총 4개가 필요합니다. 현재 ${files.length}개입니다.`
    );
  }

  for (let i = 1; i <= 4; i++) {
    const expected = `page${i}.html`;

    if (!files.includes(expected)) {
      throw new Error(
        `${expected} 파일이 없습니다.`
      );
    }
  }

  console.log("HTML 파일 4개 확인 완료");

  return files;
}

// 메인 실행
async function main() {
  console.log("================================");
  console.log("경제 뉴스 인스타그램 이미지 생성");
  console.log("================================");

  // JSON 파일 확인
  if (!fs.existsSync(dataPath)) {
    throw new Error(
      "input/data.json 파일이 없습니다."
    );
  }

  // JSON 읽기
  const rawData = fs.readFileSync(
    dataPath,
    "utf8"
  );

  data = JSON.parse(rawData);

  console.log("JSON 데이터 읽기 성공");
  console.log("분석 날짜:", data.market_date);
  console.log("경제 뉴스:", data.news_top3?.length ?? 0);

  // JSON 구조 검사
  validateData();

  // HTML 파일 확인
  const files = getHtmlFiles();

  // 출력 폴더 정리
  cleanOutputDirectory();

  // Playwright 브라우저 실행
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT
      },
      deviceScaleFactor: 1
    });

    // 이미지 생성 전 브라우저 오류 확인
    page.on("pageerror", error => {
      console.error(
        "브라우저 페이지 오류:",
        error.message
      );
    });

    // HTML 4장 순차 렌더링
    for (const file of files) {
      console.log("--------------------------------");
      console.log(`렌더링 시작: ${file}`);

      const inputPath = path.join(
        inputDir,
        file
      );

      const originalHtml = fs.readFileSync(
        inputPath,
        "utf8"
      );

      // JSON 데이터 삽입
      const finalHtml = renderTemplate(
        originalHtml,
        file
      );

      // 처리되지 않은 표현식 확인
      const remaining = finalHtml.match(
        /\{\{[\s\S]*?\}\}/g
      );

      if (remaining) {
        throw new Error(
          `${file}에 처리되지 않은 표현식이 ${remaining.length}개 있습니다.`
        );
      }

      // 렌더링 HTML 저장
      const renderedPath = path.join(
        renderedDir,
        file
      );

      fs.writeFileSync(
        renderedPath,
        finalHtml,
        "utf8"
      );

      // 브라우저에 HTML 표시
      await page.goto(
        "file://" + path.resolve(renderedPath),
        {
          waitUntil: "networkidle",
          timeout: 60000
        }
      );

      // 폰트 및 이미지 로딩 대기
      await page.evaluate(async () => {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }

        const images = Array.from(
          document.images
        );

        await Promise.all(
          images.map(image => {
            if (image.complete) {
              return Promise.resolve();
            }

            return new Promise(resolve => {
              image.onload = resolve;
              image.onerror = resolve;
            });
          })
        );
      });

      // JPEG 생성
      const outputName = file.replace(
        /\.html$/i,
        ".jpg"
      );

      const outputPath = path.join(
        outputDir,
        outputName
      );

      await page.screenshot({
        path: outputPath,
        type: "jpeg",
        quality: JPEG_QUALITY,
        fullPage: false
      });

      // 생성 결과 확인
      if (
        !fs.existsSync(outputPath) ||
        fs.statSync(outputPath).size === 0
      ) {
        throw new Error(
          `${outputName} 이미지 생성에 실패했습니다.`
        );
      }

      console.log(
        `이미지 생성 완료: ${outputName}`
      );

      console.log(
        "파일 크기:",
        fs.statSync(outputPath).size,
        "bytes"
      );
    }

    // 최종 이미지 4장 확인
    const generatedImages = [
      "page1.jpg",
      "page2.jpg",
      "page3.jpg",
      "page4.jpg"
    ];

    for (const file of generatedImages) {
      const filePath = path.join(
        outputDir,
        file
      );

      if (
        !fs.existsSync(filePath) ||
        fs.statSync(filePath).size === 0
      ) {
        throw new Error(
          `최종 이미지 확인 실패: ${file}`
        );
      }
    }

    console.log("================================");
    console.log("JPEG 이미지 4장 생성 성공!");
    console.log("================================");

  } finally {
    await browser.close();
  }
}

// 실행
main().catch(error => {
  console.error("이미지 생성 실패:");
  console.error(error);

  process.exit(1);
});
