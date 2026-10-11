// The professional kitchen's own types. They deliberately share NOTHING with ./types.ts one
// directory up: a dish is not a recipe, and a staff member is not a family member. Two types
// that look alike today and diverge tomorrow are worse than two separate ones.
export type StaffRole = "owner" | "chef" | "site_manager" | "cook";

export type Org = { id: string; name: string };
export type Site = { id: string; org_id: string; name: string };

// site_id null means GROUP-WIDE. For an owner or a chef that is normal. For a site_manager or
// a cook it means they belong to no site, and the database's read ladder then shows them
// nothing until a dish reaches the menu.
export type StaffMember = {
  user_id: string;
  role: StaffRole;
  site_id: string | null;
  display_name: string;
};

export type Invite = { org_name: string; role: StaffRole; site_name: string | null };
