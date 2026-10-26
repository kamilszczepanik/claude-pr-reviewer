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

export const parseReview = (value) =>
  reviewSchema.parse(typeof value === "string" ? JSON.parse(value) : value);

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
