package users

// RoleKey is a string alias to keep role constants type-safe.
type RoleKey string

const (
	// Platform-level roles referenced by the Architect service for overrides.
	RolePlatformAdmin   RoleKey = "platform.admin"
	RolePlatformSupport RoleKey = "platform.support"

	// App-level roles.
	RoleArchitectAdmin     RoleKey = "architect.admin"
	RoleArchitectSupport   RoleKey = "architect.support"
	RoleArchitectHomeowner RoleKey = "architect.homeowner"
	RoleArchitectProvider  RoleKey = "architect.provider"

	RoleArchitectArchitect        RoleKey = "architect.architect"
	RoleArchitectQuantitySurveyor RoleKey = "architect.quantity_surveyor"
	RoleArchitectLandSurveyor     RoleKey = "architect.land_surveyor"
	RoleArchitectLawyer           RoleKey = "architect.lawyer"
	RoleArchitectMaterialSupplier RoleKey = "architect.material_supplier"
	RoleArchitectContractor       RoleKey = "architect.contractor"
	RoleArchitectHandyman         RoleKey = "architect.handyman"
	RoleArchitectInteriorDesigner RoleKey = "architect.interior_designer"
	RoleArchitectMover            RoleKey = "architect.mover"
)

// ProfileType enumerates the supported provider specialisations.
type ProfileType string

const (
	ProfileHomeowner       ProfileType = "homeowner"
	ProfileArchitect        ProfileType = "architect"
	ProfileQuantitySurveyor ProfileType = "quantity_surveyor"
	ProfileLandSurveyor     ProfileType = "land_surveyor"
	ProfileLawyer           ProfileType = "lawyer"
	ProfileMaterialSupplier ProfileType = "material_supplier"
	ProfileContractor       ProfileType = "contractor"
	ProfileHandyman         ProfileType = "handyman"
	ProfileInteriorDesigner ProfileType = "interior_designer"
	ProfileMover            ProfileType = "mover"
)

// ProviderProfile captures metadata used by onboarding flows and UI copy.
type ProviderProfile struct {
	Type        ProfileType
	Label       string
	Description string
	Role        RoleKey
}

// ProviderProfiles lists all supported provider profile metadata.
var ProviderProfiles = []ProviderProfile{
	{
		Type:        ProfileHomeowner,
		Label:       "Homeowner",
		Description: "Property owners managing their own construction projects.",
		Role:        RoleArchitectHomeowner,
	},
	{
		Type:        ProfileArchitect,
		Label:       "Architect / Consultant",
		Description: "Licensed architects and design consultants offering concept-to-permit services.",
		Role:        RoleArchitectArchitect,
	},
	{
		Type:        ProfileQuantitySurveyor,
		Label:       "Quantity Surveyor",
		Description: "Cost estimators delivering BOQs, value engineering, and budget oversight.",
		Role:        RoleArchitectQuantitySurveyor,
	},
	{
		Type:        ProfileLandSurveyor,
		Label:       "Land Surveyor",
		Description: "Surveyors providing boundary, topographical, and geospatial assessments.",
		Role:        RoleArchitectLandSurveyor,
	},
	{
		Type:        ProfileLawyer,
		Label:       "Construction Lawyer",
		Description: "Legal specialists handling contracts, compliance, and dispute resolution.",
		Role:        RoleArchitectLawyer,
	},
	{
		Type:        ProfileMaterialSupplier,
		Label:       "Material Supplier",
		Description: "Vendors supplying construction materials, finishes, and fixtures.",
		Role:        RoleArchitectMaterialSupplier,
	},
	{
		Type:        ProfileContractor,
		Label:       "Contractor",
		Description: "General contractors or specialty trades executing construction projects.",
		Role:        RoleArchitectContractor,
	},
	{
		Type:        ProfileHandyman,
		Label:       "Handyman / Maintenance",
		Description: "Small job specialists for maintenance, repairs, and minor renovations.",
		Role:        RoleArchitectHandyman,
	},
	{
		Type:        ProfileInteriorDesigner,
		Label:       "Interior Designer",
		Description: "Interior designers and stylists delivering FF&E selections and staging.",
		Role:        RoleArchitectInteriorDesigner,
	},
	{
		Type:        ProfileMover,
		Label:       "Moving & Logistics",
		Description: "Relocation and installation logistics providers.",
		Role:        RoleArchitectMover,
	},
}

// ProviderRoleByType maps a profile type to the role key required for access.
var ProviderRoleByType = map[ProfileType]RoleKey{
	ProfileHomeowner:       RoleArchitectHomeowner,
	ProfileArchitect:        RoleArchitectArchitect,
	ProfileQuantitySurveyor: RoleArchitectQuantitySurveyor,
	ProfileLandSurveyor:     RoleArchitectLandSurveyor,
	ProfileLawyer:           RoleArchitectLawyer,
	ProfileMaterialSupplier: RoleArchitectMaterialSupplier,
	ProfileContractor:       RoleArchitectContractor,
	ProfileHandyman:         RoleArchitectHandyman,
	ProfileInteriorDesigner: RoleArchitectInteriorDesigner,
	ProfileMover:            RoleArchitectMover,
}

// ProviderTypeLabels exposes a convenient lookup for display names.
var ProviderTypeLabels = map[ProfileType]string{
	ProfileHomeowner:       "Homeowner",
	ProfileArchitect:        "Architect / Consultant",
	ProfileQuantitySurveyor: "Quantity Surveyor",
	ProfileLandSurveyor:     "Land Surveyor",
	ProfileLawyer:           "Construction Lawyer",
	ProfileMaterialSupplier: "Material Supplier",
	ProfileContractor:       "Contractor",
	ProfileHandyman:         "Handyman / Maintenance",
	ProfileInteriorDesigner: "Interior Designer",
	ProfileMover:            "Moving & Logistics",
}

// ProviderTypes returns the list of supported profile types in a stable order.
func ProviderTypes() []ProfileType {
	types := make([]ProfileType, 0, len(ProviderProfiles))
	for _, profile := range ProviderProfiles {
		types = append(types, profile.Type)
	}
	return types
}
