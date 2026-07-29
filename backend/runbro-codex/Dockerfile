FROM public.ecr.aws/lambda/nodejs:22

ARG CODEX_VERSION=0.146.0

RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force

COPY handler.mjs response-schema.json ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
