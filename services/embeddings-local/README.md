# Serviço local de embeddings

Executa exclusivamente o perfil `multilingual-e5-small-v1`. Os pesos precisam
estar previamente disponíveis em `/models/multilingual-e5-small`; o processo usa
modo offline, não baixa artefatos durante consultas e recusa entradas acima de
512 tokens em vez de truncá-las.

Prepare o artefato no host antes de construir/subir o Compose:

```bash
hf download intfloat/multilingual-e5-small \
  --revision fd1525a9fd15316a2d503bf26ab031a61d056e98 \
  --local-dir models/multilingual-e5-small
```

O serviço deve permanecer em rede privada. Configure o worker com
`EMBEDDINGS_URL=http://127.0.0.1:8090` (ou o endereço interno equivalente).
