import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low"];

const reviewSchema = z.object({
  summary: z.string().min(1),
  comments: z.array(
    z.object({
      path: z.string().min(1),
      line: z.number().int().min(1),
      severity: z.enum(SEVERITIES),
      body: z.string().min(1),
    }),
  ),
});

export const REVIEW_JSON_SCHEMA = z.toJSONSchema(reviewSchema, {
  target: "draft-7",
});

const invalidOutput = (reason) =>
  Object.assign(new Error(`Wynik modelu odrzucony: ${reason}`), {
    name: "InvalidReviewOutput",
  });

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    throw invalidOutput("to nie JSON");
  }
};

export const parseReview = (value) => {
  const parsed = reviewSchema.safeParse(
    typeof value === "string" ? parseJson(value) : value,
  );
  if (!parsed.success) {
    throw invalidOutput(
      `niezgodny ze schematem (${parsed.error.issues.length} błędów)`,
    );
  }
  return parsed.data;
};

const severityRank = (severity) => SEVERITIES.indexOf(severity);

export const selectComments = ({ comments, validLines, maxComments }) => {
  const insideDiff = comments.filter(
    ({ path, line }) => validLines.get(path)?.has(line) ?? false,
  );
  const ranked = insideDiff
    .map((comment, order) => ({ comment, order }))
    .sort(
      (left, right) =>
        severityRank(left.comment.severity) -
          severityRank(right.comment.severity) || left.order - right.order,
    )
    .map(({ comment }) => comment);
  const kept = ranked.slice(0, maxComments);
  return {
    comments: kept,
    droppedOutsideDiff: comments.length - insideDiff.length,
    droppedOverCap: insideDiff.length - kept.length,
  };
};
