import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  convertInchesToTwip,
} from "docx";
import type { Project, Chapter, Pseudonym } from "@shared/schema";

interface ManuscriptData {
  project: Project;
  chapters: Chapter[];
  pseudonym?: Pseudonym | null;
  prologue?: Chapter | null;
  epilogue?: Chapter | null;
  authorNote?: Chapter | null;
}

export async function generateManuscriptDocx(data: ManuscriptData): Promise<Buffer> {
  const { project, chapters, pseudonym, prologue, epilogue, authorNote } = data;

  const authorName = pseudonym?.name || "Anónimo";
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "", break: 5 })],
    }),
    new Paragraph({
      text: project.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "", break: 2 })],
    }),
    new Paragraph({
      text: `por ${authorName}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      style: "author",
    }),
    new Paragraph({
      children: [new TextRun({ text: "", break: 2 })],
    }),
    new Paragraph({
      text: `Género: ${project.genre} | Tono: ${project.tone}`,
      alignment: AlignmentType.CENTER,
      style: "metadata",
    }),
    new Paragraph({
      children: [new PageBreak()],
    })
  );

  if (prologue && prologue.content) {
    children.push(
      new Paragraph({
        text: "Prólogo",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
      })
    );
    addContentParagraphs(children, prologue.content);
    children.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );
  }

  const regularChapters = chapters
    .filter(c => c.chapterNumber > 0 && c.status === "completed")
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  for (const chapter of regularChapters) {
    const chapterTitle = chapter.title 
      ? `Capítulo ${chapter.chapterNumber}: ${chapter.title}`
      : `Capítulo ${chapter.chapterNumber}`;

    children.push(
      new Paragraph({
        text: chapterTitle,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
      })
    );

    if (chapter.content) {
      addContentParagraphs(children, chapter.content);
    }

    children.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );
  }

  if (epilogue && epilogue.content) {
    children.push(
      new Paragraph({
        text: "Epílogo",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
      })
    );
    addContentParagraphs(children, epilogue.content);
    children.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );
  }

  if (authorNote && authorNote.content) {
    children.push(
      new Paragraph({
        text: "Nota del Autor",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
      })
    );
    addContentParagraphs(children, authorNote.content);
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: "Georgia",
            size: 24,
          },
          paragraph: {
            spacing: {
              line: 360,
              after: 200,
            },
            indent: {
              firstLine: convertInchesToTwip(0.5),
            },
          },
        },
        {
          id: "author",
          name: "Author",
          basedOn: "Normal",
          run: {
            font: "Georgia",
            size: 28,
            italics: true,
          },
        },
        {
          id: "metadata",
          name: "Metadata",
          basedOn: "Normal",
          run: {
            font: "Georgia",
            size: 22,
            color: "666666",
          },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: "Georgia",
            size: 32,
            bold: true,
          },
          paragraph: {
            spacing: {
              before: 480,
              after: 240,
            },
          },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: "Georgia",
            size: 56,
            bold: true,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: project.title,
                    font: "Georgia",
                    size: 20,
                    italics: true,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: "Georgia",
                    size: 20,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

function removeStyleGuideContamination(content: string): string {
  let cleaned = content;
  
  const styleGuidePatterns = [
    /^#+ *Literary Style Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *Writing Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *The Master of[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *Guía de Estilo[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
    /^#+ *Guía de Escritura[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
    /^###+ *Checklist[^\n]*\n[\s\S]*?(?=^#{1,2} *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo|Epilogue|Epílogo)\b|\n---\n|$)/gmi,
    /\n---\n[\s\S]*?(?:Style Guide|Guía de Estilo|Writing Guide|Guía de Escritura)[\s\S]*?\n---\n/gi,
  ];
  
  for (const pattern of styleGuidePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  const metaSectionPatterns = [
    /^#+ *\d+\. *(?:Narrative Architecture|Character Construction|Central Themes|Language and Stylistic|Tone and Atmosphere)[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo)\b|$)/gmi,
  ];
  
  for (const pattern of metaSectionPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  return cleaned.trim();
}

function addContentParagraphs(children: Paragraph[], content: string): void {
  let cleanedContent = content;
  const continuityMarker = "---CONTINUITY_STATE---";
  const markerIndex = cleanedContent.indexOf(continuityMarker);
  if (markerIndex !== -1) {
    cleanedContent = cleanedContent.substring(0, markerIndex).trim();
  }
  
  cleanedContent = removeStyleGuideContamination(cleanedContent);
  
  const paragraphs = cleanedContent.split(/\n\n+/);
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed && !trimmed.startsWith("# ")) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmed,
            }),
          ],
          spacing: { after: 200 },
        })
      );
    }
  }
}
