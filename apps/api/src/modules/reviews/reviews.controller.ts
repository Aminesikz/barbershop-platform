import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop } from '../../shared/reqContext.js';
import { uuid } from '../../shared/validation.js';
import * as svc from './reviews.service.js';

// Review tokens are 32 random bytes base64url-encoded (43 chars). The loose
// bound rejects junk early without encoding the exact length as a contract.
const reviewToken = z.string().min(20).max(128);

const contextQuery = z.object({ token: reviewToken }).strict();

const submitSchema = z
  .object({
    token: reviewToken,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(600).optional(),
  })
  .strict();

const listAllQuery = z
  .object({ status: z.enum(['pending', 'approved', 'rejected']).optional() })
  .strict();

const idParam = z.object({ id: uuid });
const moderateBody = z.object({ status: z.enum(['approved', 'rejected']) }).strict();

/** Public: approved reviews + rating aggregates for the shop page. */
export async function listPublic(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  res.json(await svc.listPublicReviews(shop.id));
}

/** Public: booking context behind a review token (the /review landing page). */
export async function context(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { token } = contextQuery.parse(req.query);
  res.json({ context: await svc.getReviewContext(shop.id, token) });
}

/** Public: consume the token, create the review (pending until owner approval). */
export async function submit(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const body = submitSchema.parse(req.body);
  const comment = body.comment && body.comment.length > 0 ? body.comment : null;
  const review = await svc.submitReview(shop.id, { token: body.token, rating: body.rating, comment });
  res.status(201).json({ review });
}

/** Owner: full moderation list. */
export async function listAll(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { status } = listAllQuery.parse(req.query);
  res.json({ reviews: await svc.listAllReviews(shop.id, status) });
}

/** Owner: approve or reject. */
export async function moderate(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { id } = idParam.parse(req.params);
  const { status } = moderateBody.parse(req.body);
  res.json({ review: await svc.moderateReview(shop.id, id, status) });
}
