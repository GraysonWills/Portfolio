export type GrowthPlacement =
  | 'header'
  | 'home_writing'
  | 'blog_index'
  | 'article_end'
  | 'footer'
  | 'floating_support';

export type GrowthAction = 'subscribe' | 'support';

export interface GrowthContext {
  placement: GrowthPlacement;
  postId?: string | null;
  postSlug?: string | null;
  conversionId?: string | null;
}

export function growthMetadata(
  action: GrowthAction,
  context: GrowthContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action,
    placement: context.placement,
    postId: String(context.postId || '').trim() || null,
    postSlug: String(context.postSlug || '').trim() || null,
    conversionId: String(context.conversionId || '').trim() || null,
    ...extra
  };
}
