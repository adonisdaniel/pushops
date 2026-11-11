package domain

import (
	"fmt"
	"math/rand"
	"strings"
	"time"
	"unicode"
)

var nickAdjectives = []string{
	"Atómico", "Veloz", "Férreo", "Impacial", "Titán", "Fénix", "Halcón", "Relámpago",
	"Colosal", "Implacable", "Invencible", "Sideral", "Glacial", "Solar", "Lunar", "Etéreo",
	"Brutal", "Preciso", "Feroz", "Ninja", "Spectra", "Cíclope", "Kraken", "Marea",
	"Vendaval", "Tormenta", "Obsidiana", "Acero", "Fuego", "Hielo", "Trueno", "Rayo",
	"Cometa", "Nova", "Quásar", "Azote", "Colmillón", "Furia", "Sediento", "Hambriento",
	"Inagotable", "Imparable", "Letal", "Salvaje", "Domado", "Curado", "Cegador", "Invisible",
	"Fantasma", "Colmillo", "Garra", "Púa", "Acorazado", "Diamante", "Jade", "Zafiro",
	"Rubí", "Esmeralda", "Ónice", "Ágata", "Topacio", "Perla", "Corbeta", "Místico",
	"Rúnico", "Arcano", "Legendario", "Mítico", "Ancestral", "Primordial", "Eterno", "Infinito",
	"Silencioso", "Oculto", "Nítido", "Quirúrgico", "Atávico", "Bestial", "Ágil", "Flexible",
	"Explosivo", "Combativo", "Aplastante", "Incontenible", "Descomunal", "Ciclón", "Huracán",
	"Tifón", "Monzón", "Ráfaga", "Estallido", "Reacción", "Detonación", "Cataclismo", "Apocalipsis",
	"Ragnarök", "Épico", "Héroico", "Valiente", "Intrépido", "Audaz", "Fiero", "Tenaz",
	"Inquebrantable", "Incorruptible", "Impenetrable", "Coraza", "Titular", "Supremo", "Máximo",
	"Definitivo", "Absoluto", "Inigualable", "Imparable", "Cosmico", "Sideral", "Vulcan", "Magma",
	"Obsidiana", "Diamante", "Cristal", "Ébano", "Corona", "Cetro", "Manto", "Yunque",
	"Martillo", "Hacha", "Espada", "Ballesta", "Arco", "Fauces", "Colmillo", "Garra",
	"Pluma", "Alas", "Vuelo", "Tormenta", "Ciclón", "Huracán", "Maremágnum", "Tsunami",
	"Nitro", "Turbo", "Apolo", "Hércules", "Spartaco", "Titán", "Coloso", "Gigante",
	"Minimal", "Corto", "Directo", "Francо", "Puro", "Crudo", "Simple", "Nítido",
}

var nickNouns = []string{
	"Puma", "Tigre", "Oso", "Lince", "Búfalo", "Águila", "Tiburón", "Pantera",
	"Gorila", "Rinoceronte", "Cocodrilo", "Cóndor", "Guepardo", "Kodiak", "Zorro", "Lobo",
	"León", "Cobra", "Escorpión", "Mantis", "Camaleón", "Salamandra", "Dragón", "Grifo",
	"Unicornio", "Centauro", "Golem", "Medusa", "Basilisco", "Gárgola", "Arácnido", "Araña",
	"Avispa", "Avispón", "Escarabajo", "Cigüeña", "Halcón", "Búho", "Cuervo", "Fénix",
	"Quetzal", "Cóndor", "Anaconda", "Víbora", "Mamut", "Saber", "Tigre Blanco", "Rino",
	"Búfalo", "Ciervo", "Lobo", "Zorro", "Gato", "Pantera", "Leopardo", "Ocelote",
	"Armadillo", "Pangolín", "Equidna", "Cangrejo", "Pulpo", "Calamar", "Foca", "Orca",
	"Manta", "Tiburón", "Pez Sword", "Esturión", "Anguila", "Piraña", "Bala", "Salmón",
	"Cuervo", "Mirlo", "Halcón", "Ganso", "Cisne", "Flamenco", "Avestruz", "Águila",
	"Titán", "Coloso", "Centauro", "Gólem", "Ifrit", "Djinn", "Oni", "Tanuki",
	"Ninja", "Samurái", "Ronin", "Monje", "Guerrero", "Berserker", "Vikingo", "Spartano",
	"Leviatán", "Behemot", "Kraken", "Hidra", "Quimera", "Gorgona", "Sirena", "Ciclope",
	"Polifemo", "Antedono", "Orfeo", "Hércules", "Aquiles", "Odiseo", "Pericles", "Cesar",
	"Molon", "Kilo", "Tonel", "Kátana", "Naginata", "Yari", "Nunchaku", "Sai",
	"Press", "Sentadilla", "Dominada", "Plancha", "Cardio", "HIIT", "Sprint", "Abdominal",
	"Zancada", "Burpee", "Trote", "Esprint", "Mountain", "Skipping", "Remo", "Pesa",
	"Fondo", "Series", "Tempo", "Ritmo", "Pulso", "Aliento", "Sudor", "Fuerza",
}

const (
	nickMinLen = 3
	nickMaxLen = 24
)

// RandomNickname produces a pronounceable nickname like "Puma Atómico".
// The caller must verify uniqueness against the database before using it.
func RandomNickname(rnd *rand.Rand) string {
	if rnd == nil {
		rnd = rand.New(rand.NewSource(time.Now().UnixNano()))
	}
	adj := nickAdjectives[rnd.Intn(len(nickAdjectives))]
	noun := nickNouns[rnd.Intn(len(nickNouns))]
	return adj + " " + noun
}

// RandomNicknameWithSuffix is the fallback when the plain combination is taken.
func RandomNicknameWithSuffix(rnd *rand.Rand) string {
	base := RandomNickname(rnd)
	suffix := rnd.Intn(9000) + 100
	return fmt.Sprintf("%s %d", base, suffix)
}

// NormalizeNickname trims and collapses whitespace for comparison purposes.
func NormalizeNickname(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// ValidateNickname checks that a user-supplied nickname is acceptable.
// Rules: 3-24 characters, only letters/digits/spaces/underscore/hyphen,
// must contain at least one letter, and no leading/trailing separators.
func ValidateNickname(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return fmt.Errorf("el nickname no puede estar vacío")
	}
	runes := []rune(s)
	if len(runes) < nickMinLen {
		return fmt.Errorf("el nickname debe tener al menos %d caracteres", nickMinLen)
	}
	if len(runes) > nickMaxLen {
		return fmt.Errorf("el nickname no puede superar %d caracteres", nickMaxLen)
	}
	hasLetter := false
	for i, r := range runes {
		switch {
		case unicode.IsLetter(r):
			hasLetter = true
		case unicode.IsDigit(r):
		case r == ' ' || r == '_' || r == '-':
			if i == 0 || i == len(runes)-1 {
				return fmt.Errorf("el nickname no puede empezar ni terminar con espacio, guion o guion bajo")
			}
		default:
			return fmt.Errorf("el nickname solo admite letras, números, espacios, guiones y guiones bajos")
		}
	}
	if !hasLetter {
		return fmt.Errorf("el nickname debe incluir al menos una letra")
	}
	return nil
}
