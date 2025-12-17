.PHONY: install run-backend run-frontend migrate test

install:
	cd backend && uv sync
	cd frontend && npm install

run-backend:
	cd backend && uv run manage.py runserver 0.0.0.0:8000

run-frontend:
	cd frontend && npm run dev

migrate:
	cd backend && uv run manage.py migrate

test:
	cd backend && uv run manage.py test
