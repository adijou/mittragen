export type SponsorPackagePrice = {
  id: string;
  price_cents: number;
};

export const annualValueForPackage = (
  packageVersionId: string,
  packageOptions: SponsorPackagePrice[],
): string | null => {
  const selectedPackage = packageOptions.find((option) => option.id === packageVersionId);
  return selectedPackage ? String(selectedPackage.price_cents / 100) : null;
};
