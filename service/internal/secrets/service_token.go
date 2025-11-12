package secrets

import (
	"errors"
	"os"
	"strings"
)

var ErrTokenFileMissing = errors.New("service token file missing")

// ServiceToken resolves the service-to-service bearer token by preferring the in-memory
// environment value and falling back to a file path.
func ServiceToken(envToken, filePath string) (string, error) {
	token := strings.TrimSpace(envToken)
	if token != "" {
		return token, nil
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return "", nil
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrTokenFileMissing
		}
		return "", err
	}
	token = strings.TrimSpace(string(data))
	return token, nil
}
